"""Stage 4 - assemble the 9:16 reel: lip-synced scenes + VO + our own Jingle-Bells bed (public-domain tune,
synthesised by us) + pre-rendered Arabic captions. Output OUT/xmas-reel-colab.mp4 (1080x1920, 30 fps)."""
import json, os, subprocess
WORK = os.environ.get("WORK", "/content/work"); OUT = os.environ.get("OUT", "/content/out")
cfg = json.load(open(f"{WORK}/config.json")); scn = json.load(open(f"{WORK}/inputs/scenes.json"))["scenes"]
durs = json.load(open(f"{OUT}/audio/durations.json"))["durations"]
os.makedirs(f"{WORK}/asm", exist_ok=True)
def ff(*a): subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *a], check=True)
END_HOLD = float(cfg.get("end_hold", 1.2)); parts = []
for n, s in enumerate(scn):
    i = s["id"]; d = durs[s["line"] - 1] + (END_HOLD if n == len(scn) - 1 else 0)
    src = f"{OUT}/clips/lipsync_scene{i}.mp4"
    if not os.path.exists(src): src = f"{OUT}/clips/i2v_scene{i}.mp4"
    cap = f"{WORK}/inputs/cap{s['line']}.png"
    vf = (f"[0:v]fps=30,scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,setsar=1,"
          f"tpad=stop_mode=clone:stop_duration=10,trim=duration={d:.3f},setpts=PTS-STARTPTS[v]")
    if cfg.get("captions", True) and os.path.exists(cap):
        vf += f";[1:v]format=rgba[c];[v][c]overlay=0:0:format=auto,format=yuv420p[vo]"; m = "[vo]"; extra = ["-loop", "1", "-i", cap]
    else:
        vf += ";[v]format=yuv420p[vo]"; m = "[vo]"; extra = []
    dst = f"{WORK}/asm/scene{i}.mp4"
    ff("-i", src, *extra, "-filter_complex", vf, "-map", m, "-an", "-t", f"{d:.3f}", "-c:v", "libx264", "-crf", "16",
       "-preset", "medium", "-pix_fmt", "yuv420p", dst)
    parts.append(dst); print(f"[asm] scene {i}: {d:.2f}s from {os.path.basename(src)}")
with open(f"{WORK}/asm/list.txt", "w") as f:
    f.writelines(f"file '{p}'\n" for p in parts)
ff("-f", "concat", "-safe", "0", "-i", f"{WORK}/asm/list.txt", "-c", "copy", f"{WORK}/asm/video.mp4")
total = sum(durs) + END_HOLD
mus = f"{WORK}/inputs/music.mp3"
ff("-i", f"{OUT}/audio/vo_full.wav", "-ss", "0.5", "-i", mus, "-filter_complex",
   f"[0:a]aresample=48000,apad=pad_dur={END_HOLD+0.5}[vo];"
   f"[1:a]aresample=48000,volume={cfg.get('music_gain', 0.22)},afade=t=in:d=0.3,afade=t=out:st={total-1.0:.3f}:d=1.0[m];"
   f"[vo][m]amix=inputs=2:duration=first:normalize=0,atrim=duration={total:.3f},loudnorm=I=-14:TP=-1.0:LRA=11,aresample=48000[a]",
   "-map", "[a]", "-c:a", "pcm_s16le", f"{WORK}/asm/mix.wav")
final = f"{OUT}/xmas-reel-colab.mp4"
ff("-i", f"{WORK}/asm/video.mp4", "-i", f"{WORK}/asm/mix.wav", "-map", "0:v", "-map", "1:a", "-c:v", "copy",
   "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", final)
print("[asm] final:", final, subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
      "-of", "csv=p=0", final]).decode().strip(), "s")
