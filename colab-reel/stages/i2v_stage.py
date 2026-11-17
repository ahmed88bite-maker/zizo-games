"""Stage 2 - image-to-video with LTX-Video 0.9.8 2B distilled (Lightricks, 8 steps).
Each scene starts from the real Shein avatar still (clothes come from the photo, not invented).
Prompt embeddings were pre-computed with T5-XXL off-Colab (assets/ltx_prompt_embeds.npz), so the
19 GB text encoder is never downloaded here. Falls back to a Ken-Burns move if a clip fails.
"""
import gc, json, math, os, subprocess, sys, time, traceback
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
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
    return max(25, min(n, int(cfg.get("max_frames", 97))))

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
    pipe.to(dev)
    return pipe

# VAE decode modes, tried in order on OOM. "plain" is artifact-free (box test: ~5 GB activations for 480x832x97);
# spatial tiling adds faint seams; diffusers' temporal (framewise) tiling adds visible streaks -> last resort only.
DECODE_MODES = [("plain", False, False), ("tiled", True, False), ("tiled+framewise", True, True)]


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

def free():
    gc.collect()
    if dev == "cuda": torch.cuda.empty_cache()

def gpu_gb():
    return round(torch.cuda.max_memory_allocated() / 1e9, 2) if dev == "cuda" else None

LAST_DECODE = [None]

def generate(pipe, img, i, w, h, nf):
    """Denoise with transformer+VAE on GPU, then park the transformer on CPU and decode with the VAE alone."""
    dt = pipe.transformer.dtype
    pe, pm = embeds(f"scene{i}", dt)
    gen = torch.Generator(device="cpu").manual_seed(int(cfg.get("seed", 42)) + i)
    pipe.transformer.to(dev)
    with torch.no_grad():
        lat = pipe(image=img, prompt_embeds=pe, prompt_attention_mask=pm, width=w, height=h, num_frames=nf,
                   frame_rate=FPS, timesteps=TIMESTEPS, guidance_scale=1.0, image_cond_noise_scale=0.0,
                   generator=gen, output_type="latent").frames
    del pe, pm
    if dev == "cuda":
        pipe.transformer.to("cpu"); free()           # frees ~3.9 GB for the decoder
    vae = pipe.vae
    with torch.no_grad():
        lat = pipe._denormalize_latents(lat, vae.latents_mean, vae.latents_std, vae.config.scaling_factor).to(vae.dtype)
        tstep = None
        if vae.config.timestep_conditioning:
            noise = torch.randn(lat.shape, generator=gen, dtype=torch.float32).to(lat.device, lat.dtype)
            tstep = torch.tensor([0.05], device=lat.device, dtype=lat.dtype)        # decode_timestep
            lat = (1 - 0.025) * lat + 0.025 * noise                                 # decode_noise_scale
            del noise
    for k, (name, tiling, framewise) in enumerate(DECODE_MODES):
        vae.use_tiling = tiling
        vae.use_framewise_decoding = framewise
        if tiling:
            vae.tile_sample_min_height = vae.tile_sample_min_width = 384
            vae.tile_sample_stride_height = vae.tile_sample_stride_width = 320
        try:
            with torch.no_grad():
                video = vae.decode(lat, tstep, return_dict=False)[0]
                frames = pipe.video_processor.postprocess_video(video, output_type="pil")[0]
            del video; free()
            LAST_DECODE[0] = name
            return frames
        except torch.cuda.OutOfMemoryError:
            print(f"[i2v] scene {i}: VAE decode OOM in '{name}' mode (peak {gpu_gb()} GB)", flush=True)
            video = None; free()
            if k == len(DECODE_MODES) - 1:
                raise

def main():
    from diffusers.utils import export_to_video
    t_all = time.time()
    dtype = {"fp16": torch.float16, "bf16": torch.bfloat16, "fp32": torch.float32}[cfg.get("ltx_dtype", "fp16")]
    errlog = open(f"{OUT}/clips/i2v_errors.log", "w")
    pipe = None
    try:
        t = time.time(); pipe = load_models(dtype)
        print(f"[i2v] LTX 2B 0.9.8 distilled loaded ({dtype}) in {time.time()-t:.1f}s; GPU {gpu_gb()} GB", flush=True)
    except Exception as e:
        traceback.print_exc(file=errlog); errlog.flush()
        print("[i2v] model load failed -> Ken Burns fallback for all scenes:", repr(e)[:400], flush=True)
    # resolution ladder: tried in order on CUDA OOM
    ladder = [(W, H, None), (384, 672, None), (384, 672, 65)]
    for s in scn["scenes"]:
        i = s["id"]; still = f"{WORK}/inputs/{s['image']}"; dst = f"{OUT}/clips/i2v_scene{i}.mp4"
        nf_full = n_frames(durs[s["line"] - 1]); t = time.time(); mode = "kenburns"; used = None
        if dev == "cuda": torch.cuda.reset_peak_memory_stats()
        if pipe is not None:
            for (w, h, cap) in ladder:
                nf = min(nf_full, cap) if cap else nf_full
                try:
                    img = cover_crop(Image.open(still).convert("RGB"), w, h)
                    if cfg.get("debug_force_oom_first") and (w, h, cap) == ladder[0]:
                        raise torch.cuda.OutOfMemoryError("debug: simulated OOM")
                    fr = generate(pipe, img, i, w, h, nf)
                    if not good(fr) and pipe.transformer.dtype == torch.float16:
                        print(f"[i2v] scene {i}: fp16 output looks broken (NaN/black) -> reloading in bf16", flush=True)
                        pipe = None; free(); pipe = load_models(torch.bfloat16)
                        fr = generate(pipe, img, i, w, h, nf)
                    if not good(fr):
                        raise RuntimeError("bad frames (NaN/black)")
                    if (w, h) != (W, H):          # keep every clip the same size for the later stages
                        fr = [f.resize((W, H), Image.LANCZOS) for f in fr]
                    export_to_video(fr, dst, fps=FPS); mode = "ltx"; used = f"{w}x{h}x{nf} decode={LAST_DECODE[0]}"
                    del fr; free()
                    break
                except torch.cuda.OutOfMemoryError as e:
                    print(torch.cuda.memory_summary(abbreviated=True) if dev == "cuda" else "", file=errlog)
                    print(f"[i2v] scene {i}: CUDA OOM at {w}x{h}x{nf} (peak {gpu_gb()} GB) -> next rung", flush=True)
                    errlog.write(f"scene {i} OOM at {w}x{h}x{nf}: {str(e)[:500]}\n"); errlog.flush()
                except Exception as e:
                    print(f"[i2v] scene {i}: LTX error at {w}x{h}x{nf}: {repr(e)[:300]}", flush=True)
                    errlog.write(f"scene {i} error at {w}x{h}x{nf}:\n"); traceback.print_exc(file=errlog); errlog.flush()
                    break
                finally:
                    if pipe is not None and dev == "cuda":
                        pipe.transformer.to("cpu")
                    free()
        if mode != "ltx":
            print(f"[i2v] scene {i}: -> Ken Burns fallback", flush=True)
            ken_burns(still, dst, nf_full)
        print(f"[i2v] scene {i}: {used or nf_full} via {mode} in {time.time()-t:.1f}s, GPU peak {gpu_gb()} GB -> {dst}", flush=True)
        REPORT.append({"scene": i, "mode": mode, "size": used, "frames_needed": nf_full,
                       "gpu_peak_gb": gpu_gb(), "seconds": round(time.time() - t, 1)})
    json.dump({"scenes": REPORT, "seconds": round(time.time() - t_all, 1)}, open(f"{OUT}/clips/i2v_report.json", "w"), indent=1)
    print(f"[i2v] done in {time.time()-t_all:.1f}s", flush=True)

if __name__ == "__main__":
    main()
