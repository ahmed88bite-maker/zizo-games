#!/bin/bash
# Small, safe patches to LatentSync @ a229c39: device-agnostic face detector / image processor.
set -e
cd "$1"
sed -i 's/ImageProcessor(height, device="cuda", mask_image=mask_image)/ImageProcessor(height, device=str(device), mask_image=mask_image)/' latentsync/pipelines/lipsync_pipeline.py
sed -i 's/providers=\["CUDAExecutionProvider"\],/providers=(["CUDAExecutionProvider", "CPUExecutionProvider"] if "cuda" in str(device) else ["CPUExecutionProvider"]),/' latentsync/utils/face_detector.py
sed -i 's/ctx_id=cuda_to_int(device)/ctx_id=(cuda_to_int(device) if "cuda" in str(device) else -1)/' latentsync/utils/face_detector.py
# allow face detection on CPU too (upstream refuses); no effect on GPU runs
python3 - <<'PY'
p = "latentsync/utils/image_processor.py"; s = open(p).read()
s = s.replace('if device == "cpu":\n            self.face_detector = None\n        else:\n            self.face_detector = FaceDetector(device=device)',
              'self.face_detector = FaceDetector(device=device)')
open(p, "w").write(s)
p = "latentsync/utils/affine_transform.py"; s = open(p).read()   # fp16 warps only on GPU (CPU has no half grid_sample)
s = s.replace('device="cpu", dtype=torch.float16):', 'device="cpu", dtype=None):\n        dtype = dtype or (torch.float16 if "cuda" in str(device) else torch.float32)')
open(p, "w").write(s)
PY
grep -q 'device=str(device)' latentsync/pipelines/lipsync_pipeline.py && grep -q 'CPUExecutionProvider' latentsync/utils/face_detector.py && echo "LatentSync patched"
