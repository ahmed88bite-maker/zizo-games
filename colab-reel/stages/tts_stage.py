"""Stage 1 - Egyptian-Arabic voice clone TTS (VoiceTut-TTS = OmniVoice Egyptian fine-tune).
Clones the Gemini "Aoede" reference clip and reads the reel script line by line.
Writes WORK/tts/raw_line{i}.wav and a report. Post-processing is done by post_audio.py.
"""
import json, os, re, sys, time, unicodedata
import numpy as np, soundfile as sf, torch

WORK = os.environ.get("WORK", "/content/work")
cfg = json.load(open(f"{WORK}/config.json"))
script = json.load(open(f"{WORK}/inputs/script.json"))
dev = cfg.get("device") or ("cuda" if torch.cuda.is_available() else "cpu")
os.makedirs(f"{WORK}/tts", exist_ok=True)
REPORT = {"engine": None, "lines": []}

def norm_ar(s):
    s = unicodedata.normalize("NFKC", s.lower())
    s = re.sub(r"[\u064B-\u0652\u0640]", "", s)          # harakat + tatweel
    s = re.sub("[إأآٱ]", "ا", s).replace("ى", "ي").replace("ة", "ه")
    return re.sub(r"[^\w]", "", s)

def cer(ref, hyp):
    a, b = norm_ar(ref), norm_ar(hyp)
    if not a: return 1.0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1] / len(a)

def load_asr():
    if not cfg.get("tts_pick_with_whisper", True) or dev != "cuda" or cfg.get("tts_takes", 1) < 2:
        return None
    try:
        from transformers import pipeline
        t = time.time()
        asr = pipeline("automatic-speech-recognition", model="openai/whisper-large-v3-turbo",
                       torch_dtype=torch.float16, device=dev)
        print(f"[tts] whisper-large-v3-turbo loaded in {time.time()-t:.1f}s", flush=True)
        return asr
    except Exception as e:
        print("[tts] whisper unavailable, using take 1:", repr(e)[:300], flush=True)
        return None

def main():
    t0 = time.time()
    from voicetut_tts import VoiceTutTTS
    dtype = "float16" if dev == "cuda" else "float32"
    tts = VoiceTutTTS.from_pretrained("mohammedaly22/VoiceTut-TTS", device=dev, dtype=dtype)
    sr = getattr(tts, "sampling_rate", 24000)
    print(f"[tts] VoiceTut-TTS loaded on {dev}/{dtype} in {time.time()-t0:.1f}s", flush=True)
    REPORT["engine"] = "VoiceTut-TTS (OmniVoice Egyptian fine-tune) voice-clone of Aoede ref"
    ref_audio = f"{WORK}/inputs/{script['ref_audio']}"
    takes = int(cfg.get("tts_takes", 1))
    cands = {}
    for i, text in enumerate(script["lines"], 1):
        for k in range(takes):
            torch.manual_seed(cfg.get("seed", 42) + 101 * k + i)
            t = time.time()
            p = f"{WORK}/tts/cand_line{i}_take{k+1}.wav"
            wav = tts.synthesize(text, output=p, ref_audio=ref_audio, ref_text=script["ref_text"],
                                 num_step=int(cfg.get("tts_steps", 32)), guidance_scale=2.0, speed=1.0)
            d = len(wav) / sr
            print(f"[tts] line {i} take {k+1}: {d:.2f}s audio in {time.time()-t:.1f}s", flush=True)
            cands.setdefault(i, []).append({"path": p, "dur": round(d, 3)})
    del tts
    if dev == "cuda": torch.cuda.empty_cache()
    asr = load_asr()
    for i, text in enumerate(script["lines"], 1):
        best = cands[i][0]
        if asr is not None:
            for c in cands[i]:
                w, s = sf.read(c["path"], dtype="float32")
                if w.ndim > 1: w = w.mean(1)
                hyp = asr({"raw": w, "sampling_rate": s}, generate_kwargs={"language": "arabic", "task": "transcribe"})["text"]
                c["asr"], c["cer"] = hyp, round(cer(text, hyp), 3)
                print(f"[tts] line {i} {os.path.basename(c['path'])}: CER={c['cer']}  ASR='{hyp}'", flush=True)
            best = min(cands[i], key=lambda c: c["cer"])
        os.replace(best["path"], f"{WORK}/tts/raw_line{i}.wav")
        REPORT["lines"].append({"line": i, "text": text, "chosen": os.path.basename(best["path"]), "candidates": cands[i]})
    REPORT["seconds"] = round(time.time() - t0, 1)
    json.dump(REPORT, open(f"{WORK}/tts/tts_report.json", "w"), ensure_ascii=False, indent=1)
    print(f"[tts] done in {REPORT['seconds']}s", flush=True)

if __name__ == "__main__":
    main()
