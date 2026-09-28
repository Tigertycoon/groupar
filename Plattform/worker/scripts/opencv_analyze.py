import json
import sys

try:
    import cv2
    import numpy as np
except Exception as exc:
    print(json.dumps({"error": "opencv_unavailable", "message": str(exc)}))
    sys.exit(2)

if len(sys.argv) != 2:
    print(json.dumps({"error": "usage", "message": "opencv_analyze.py <image_path>"}))
    sys.exit(2)

image_path = sys.argv[1]
image = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
if image is None:
    print(json.dumps({"error": "image_decode_failed"}))
    sys.exit(2)

blur_score = float(cv2.Laplacian(image, cv2.CV_64F).var())
contrast_score = float(np.std(image))
orb = cv2.ORB_create(nfeatures=1500)
keypoints = orb.detect(image, None)

warnings = []
if blur_score < 60:
    warnings.append("trigger_blur_low")
if contrast_score < 18:
    warnings.append("trigger_contrast_low")
if len(keypoints) < 120:
    warnings.append("trigger_feature_count_low")

print(json.dumps({
    "blurScore": round(blur_score, 3),
    "contrastScore": round(contrast_score, 3),
    "featureCount": len(keypoints),
    "warnings": warnings
}))
