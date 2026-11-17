"""Stage 3 - LatentSync 1.5 lip-sync (ByteDance, Apache-2.0). Loads the models once, syncs every scene.
Run inside the LatentSync repo dir with its own venv. Usage: python ls_runner.py jobs.json
jobs.json = [{"video": ..., "audio": ..., "out": ...}, ...]
"""
import json, os, sys, time, traceback
import torch
if torch.cuda.is_available():
    try:
        import onnxruntime as ort; ort.preload_dlls()    # let insightface find the CUDA/cuDNN libs shipped with torch
    except Exception as e:
        print("onnxruntime preload_dlls skipped:", e)
from omegaconf import OmegaConf
from diffusers import AutoencoderKL, DDIMScheduler
from accelerate.utils import set_seed
from latentsync.models.unet import UNet3DConditionModel
from latentsync.pipelines.lipsync_pipeline import LipsyncPipeline
from latentsync.whisper.audio2feature import Audio2Feature

dev = os.environ.get("LS_DEVICE") or ("cuda" if torch.cuda.is_available() else "cpu")
dtype = torch.float16 if dev == "cuda" else torch.float32      # T4 (sm75) runs fp16 fine; upstream would pick fp32
cfg_path = os.environ.get("LS_CONFIG", "configs/unet/stage2.yaml")   # 256 px = LatentSync 1.5
steps = int(os.environ.get("LS_STEPS", "20")); gscale = float(os.environ.get("LS_GUIDANCE", "1.5"))
config = OmegaConf.load(cfg_path)
jobs = json.load(open(sys.argv[1]))
t0 = time.time()
scheduler = DDIMScheduler.from_pretrained("configs")
wpath = "checkpoints/whisper/small.pt" if config.model.cross_attention_dim == 768 else "checkpoints/whisper/tiny.pt"
audio_encoder = Audio2Feature(model_path=wpath, device=dev, num_frames=config.data.num_frames,
                              audio_feat_length=config.data.audio_feat_length)
vae = AutoencoderKL.from_pretrained("stabilityai/sd-vae-ft-mse", torch_dtype=dtype)
vae.config.scaling_factor = 0.18215; vae.config.shift_factor = 0
unet, _ = UNet3DConditionModel.from_pretrained(OmegaConf.to_container(config.model), "checkpoints/latentsync_unet.pt", device="cpu")
unet = unet.to(dtype=dtype)
pipe = LipsyncPipeline(vae=vae, audio_encoder=audio_encoder, unet=unet, scheduler=scheduler).to(dev)
if os.environ.get("LS_DEEPCACHE", "1") == "1":
    from DeepCache import DeepCacheSDHelper
    helper = DeepCacheSDHelper(pipe=pipe); helper.set_params(cache_interval=3, cache_branch_id=0); helper.enable()
print(f"[lipsync] LatentSync loaded on {dev}/{dtype} ({cfg_path}, {config.data.resolution}px) in {time.time()-t0:.1f}s", flush=True)
results = []
for k, j in enumerate(jobs):
    t = time.time(); ok = False
    try:
        set_seed(1247)
        if os.path.exists(j["out"]): os.remove(j["out"])
        pipe(video_path=j["video"], audio_path=j["audio"], video_out_path=j["out"], num_frames=config.data.num_frames,
             num_inference_steps=steps, guidance_scale=gscale, weight_dtype=dtype,
             width=config.data.resolution, height=config.data.resolution,
             mask_image_path=config.data.mask_image_path, temp_dir=f"temp_ls_{k}")
        ok = os.path.exists(j["out"]) and os.path.getsize(j["out"]) > 10000
    except Exception:
        traceback.print_exc()
    if dev == "cuda": torch.cuda.empty_cache()
    print(f"[lipsync] {os.path.basename(j['out'])}: {'OK' if ok else 'FAILED'} in {time.time()-t:.1f}s", flush=True)
    results.append({"out": j["out"], "ok": ok, "seconds": round(time.time() - t, 1)})
json.dump(results, open(sys.argv[1].replace(".json", "_result.json"), "w"), indent=1)
