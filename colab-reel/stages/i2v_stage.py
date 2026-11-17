"""Stage 2 - image-to-video with LTX-Video 0.9.8 2B distilled (Lightricks, 8 steps).
Each scene starts from the real Shein avatar still (clothes come from the photo, not invented).
Prompt embeddings were pre-computed with T5-XXL off-Colab (assets/ltx_prompt_embeds.npz), so the
19 GB text encoder is never downloaded here. Falls back to a Ken-Burns move if a clip fails.
"""
import gc, json, math, os, subprocess, sys, time
import numpy as np, torch
from PIL import Image
from safetensors import safe_open

WORK = os.environ.get("WORK", "/content/work"); OUT = os.environ.get("OUT", "/content/out")
cfg = json.load(open(f"{WORK}/config.json"))
scn = json.load(open(f"{WORK}/inputs/scenes.json"))
durs = json.load(open(f"{OUT}/audio/durations.json"))["durations"]
dev = cfg.get("device") or ("cuda" if torch.cuda.is_available() else "cpu")
W, H, FPS = int(cfg.get("width", 480)), int(cfg.get("height", 832)), int(cfg.get("fps", 25))
os.makedirs(f"{OUT}/clips", exist_ok=True)
TIMESTEPS = [1000, 993, 987, 981, 975, 909, 725, 0.03]   # official 0.9.8-distilled schedule
REPORT = []

def cover_crop(img, w, h):
    sw, sh = img.size; r = max(w / sw, h / sh)
    img = img.resize((math.ceil(sw * r), math.ceil(sh * r)), Image.LANCZOS)
    x, y = (img.width - w) // 2, int((img.height - h) * 0.3)
    return img.crop((x, y, x + w, y + h))

def n_frames(sec):
    n = int(math.ceil(sec * FPS)) + 2
    n = 8 * math.ceil((n - 1) / 8) + 1
    return max(25, min(n, int(cfg.get("max_frames", 121))))

def load_models(dtype):
    from diffusers import LTXVideoTransformer3DModel, AutoencoderKLLTXVideo, LTXConditionPipeline, FlowMatchEulerDiscreteScheduler
    from huggingface_hub import hf_hub_download
    src = hf_hub_download("Lightricks/LTX-Video", "ltxv-2b-0.9.8-distilled.safetensors")
    def sub(prefix):
        sd = {}
        with safe_open(src, "pt", device="cpu") as f:           # stream tensor by tensor: low RAM peak
            for k in f.keys():
                if k.startswith(prefix):
                    t = f.get_tensor(k); sd[k] = t.to(dtype) if t.is_floating_point() else t
        return sd
    sd = sub("model.diffusion_model."); tr = LTXVideoTransformer3DModel.from_single_file(sd, torch_dtype=dtype); del sd; gc.collect()
    sd = sub("vae."); vae = AutoencoderKLLTXVideo.from_single_file(sd, torch_dtype=dtype); del sd; gc.collect()
    sch_dir = os.path.dirname(hf_hub_download("Lightricks/LTX-Video-0.9.5", "scheduler/scheduler_config.json"))
    pipe = LTXConditionPipeline(scheduler=FlowMatchEulerDiscreteScheduler.from_pretrained(sch_dir),
                                vae=vae, text_encoder=None, tokenizer=None, transformer=tr)
    pipe.to(dev); pipe.vae.enable_tiling()
    return pipe

def embeds(key, dtype):
    a = np.load(f"{WORK}/inputs/ltx_prompt_embeds.npz")[key]
    e = torch.zeros(1, 256, a.shape[1], dtype=dtype); e[0, :a.shape[0]] = torch.from_numpy(a.astype(np.float32)).to(dtype)
    m = torch.zeros(1, 256, dtype=torch.long); m[0, :a.shape[0]] = 1
    return e.to(dev), m.to(dev)

def ken_burns(still, dst, nf):
    vf = (f"scale={W*2}:{H*2}:force_original_aspect_ratio=increase,crop={W*2}:{H*2},"
          f"zoompan=z='1.0+0.06*on/{nf}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/3':d=1:s={W}x{H}:fps={FPS}")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-i", still, "-vf", vf, "-frames:v", str(nf),
                    "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", dst], check=True)

def good(frames):
    a = np.asarray(frames[len(frames) // 2]).astype(np.float32)
    return np.isfinite(a).all() and a.std() > 8 and 10 < a.mean() < 245

def main():
    from diffusers.utils import export_to_video
    t_all = time.time()
    dtype = {"fp16": torch.float16, "bf16": torch.bfloat16, "fp32": torch.float32}[cfg.get("ltx_dtype", "fp16")]
    pipe = None
    try:
        t = time.time(); pipe = load_models(dtype); print(f"[i2v] LTX 2B 0.9.8 distilled loaded ({dtype}) in {time.time()-t:.1f}s", flush=True)
    except Exception as e:
        print("[i2v] model load failed -> Ken Burns fallback for all scenes:", repr(e)[:400], flush=True)
    for s in scn["scenes"]:
        i = s["id"]; still = f"{WORK}/inputs/{s['image']}"; dst = f"{OUT}/clips/i2v_scene{i}.mp4"
        nf = n_frames(durs[s["line"] - 1]); t = time.time(); mode = "ltx"
        try:
            if pipe is None: raise RuntimeError("no model")
            img = cover_crop(Image.open(still).convert("RGB"), W, H)
            for attempt in range(2):
                pe, pm = embeds(f"scene{i}", pipe.transformer.dtype)
                fr = pipe(image=img, prompt_embeds=pe, prompt_attention_mask=pm, width=W, height=H, num_frames=nf,
                          frame_rate=FPS, timesteps=TIMESTEPS, guidance_scale=1.0, decode_timestep=0.05,
                          decode_noise_scale=0.025, image_cond_noise_scale=0.0,
                          generator=torch.Generator(device="cpu").manual_seed(int(cfg.get("seed", 42)) + i),
                          output_type="pil").frames[0]
                if good(fr): break
                if attempt == 0 and pipe.transformer.dtype == torch.float16:
                    print(f"[i2v] scene {i}: fp16 output looks broken (NaN/black) -> reloading in bf16", flush=True)
                    del pipe; gc.collect(); torch.cuda.empty_cache(); pipe = load_models(torch.bfloat16)
                else:
                    raise RuntimeError("bad frames")
            export_to_video(fr, dst, fps=FPS)
        except Exception as e:
            print(f"[i2v] scene {i}: LTX failed ({repr(e)[:200]}) -> Ken Burns fallback", flush=True)
            ken_burns(still, dst, nf); mode = "kenburns"
        if dev == "cuda": torch.cuda.empty_cache()
        print(f"[i2v] scene {i}: {nf} frames {W}x{H} via {mode} in {time.time()-t:.1f}s -> {dst}", flush=True)
        REPORT.append({"scene": i, "frames": nf, "mode": mode, "seconds": round(time.time() - t, 1)})
    json.dump({"scenes": REPORT, "seconds": round(time.time() - t_all, 1)}, open(f"{OUT}/clips/i2v_report.json", "w"), indent=1)
    print(f"[i2v] done in {time.time()-t_all:.1f}s", flush=True)

if __name__ == "__main__":
    main()
