"""Trim silence, loudness-normalise and pad each VO line; write OUT/audio/line{i}.wav (24 kHz) + 16 kHz copies."""
import json, os, subprocess, sys
WORK = os.environ.get("WORK", "/content/work"); OUT = os.environ.get("OUT", "/content/out")
cfg = json.load(open(f"{WORK}/config.json"))
n = len(json.load(open(f"{WORK}/inputs/script.json"))["lines"])
os.makedirs(f"{OUT}/audio", exist_ok=True)
lead, tail = cfg.get("vo_lead", 0.12), cfg.get("vo_tail", 0.22)
trim = ("silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,areverse,"
        "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,areverse")
durs = []
for i in range(1, n + 1):
    src = f"{WORK}/tts/raw_line{i}.wav"
    dst = f"{OUT}/audio/line{i}.wav"
    af = f"{trim},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=24000,adelay={int(lead*1000)}:all=1,apad=pad_dur={tail}"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-af", af, "-ac", "1", "-ar", "24000", dst], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", dst, "-ac", "1", "-ar", "16000", f"{OUT}/audio/line{i}_16k.wav"], check=True)
    d = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", dst]).decode())
    durs.append(round(d, 3)); print(f"[audio] line {i}: {d:.2f}s -> {dst}")
json.dump({"durations": durs}, open(f"{OUT}/audio/durations.json", "w"))
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *sum([["-i", f"{OUT}/audio/line{i}.wav"] for i in range(1, n+1)], []),
                "-filter_complex", "".join(f"[{k}:a]" for k in range(n)) + f"concat=n={n}:v=0:a=1[a]", "-map", "[a]",
                f"{OUT}/audio/vo_full.wav"], check=True)
print("[audio] total VO", round(sum(durs), 2), "s")
