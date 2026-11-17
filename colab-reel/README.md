# colab-reel — Shein Christmas reel on a free Colab T4 (open-source only)

Open in Colab: https://colab.research.google.com/github/ahmed88bite-maker/zizo-games/blob/main/colab-reel/shein_xmas_reel_free_t4.ipynb

Runtime → Change runtime type → **T4 GPU**, then **Runtime → Run all**. Output: `/content/out/xmas-reel-colab.mp4`.

| Stage | Model | Licence |
|---|---|---|
| Voice | VoiceTut-TTS (mohammedaly22, OmniVoice Egyptian fine-tune), fallback Chatterbox Multilingual | Apache-2.0 card, **base OmniVoice weights CC-BY-NC** → experiment only, not for paid ads |
| Video | LTX-Video 0.9.8 2B distilled (Lightricks) | LTX-Video Open Weights License |
| Lip-sync | LatentSync 1.5 (ByteDance) | Apache-2.0 |
| Edit | ffmpeg | — |

`assets/*.b64` are base64 copies of the binary inputs (the GitHub connector can only push text): the four avatar stills,
a 6 s Gemini-Aoede reference clip, our synthesised Jingle Bells bed (public-domain tune), pre-rendered Arabic captions,
the original Aoede lines (last-resort fallback) and pre-computed T5 prompt embeddings for LTX.
`stages/*.py` are the per-stage scripts the notebook downloads and runs.
