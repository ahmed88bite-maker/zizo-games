"""Stage 1 fallback - Chatterbox Multilingual (Resemble AI, MIT) zero-shot clone, language_id='ar'."""
import json, os, time, torch, torchaudio as ta
WORK = os.environ.get("WORK", "/content/work")
script = json.load(open(f"{WORK}/inputs/script.json"))
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
dev = "cuda" if torch.cuda.is_available() else "cpu"
t0 = time.time()
m = ChatterboxMultilingualTTS.from_pretrained(device=dev)
os.makedirs(f"{WORK}/tts", exist_ok=True)
for i, text in enumerate(script["lines"], 1):
    w = m.generate(text, language_id="ar", audio_prompt_path=f"{WORK}/inputs/{script['ref_audio']}",
                   exaggeration=0.55, cfg_weight=0.5)
    ta.save(f"{WORK}/tts/raw_line{i}.wav", w.cpu(), m.sr)
    print(f"[tts-fallback] line {i}: {w.shape[-1]/m.sr:.2f}s", flush=True)
json.dump({"engine": "Chatterbox Multilingual (fallback)", "seconds": round(time.time()-t0, 1)},
          open(f"{WORK}/tts/tts_report.json", "w"), indent=1)
