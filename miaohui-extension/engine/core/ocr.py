"""OCR：跨平台统一走 RapidOCR（纯离线 ONNX，中文高精度）。

移植说明：原项目在 macOS 上用 Apple Vision、Windows 上用 RapidOCR。
作为 LumiLuna 扩展包分发时，为保持单一代码路径与可移植的 PyInstaller
onedir 产物（不便捆绑 pyobjc），全平台统一使用 RapidOCR。
"""
import io

_ocr_engine = None


def _get_engine():
    global _ocr_engine
    if _ocr_engine is None:
        from rapidocr_onnxruntime import RapidOCR
        _ocr_engine = RapidOCR()
    return _ocr_engine


def ocr_from_jpeg(jpeg_bytes: bytes) -> str:
    """输入 JPEG 字节，返回识别文本（换行连接）。失败返回空串。"""
    try:
        import cv2
        import numpy as np

        arr = np.frombuffer(jpeg_bytes, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            return ""
        result, _ = _get_engine()(img)
        if not result:
            return ""
        lines = [r[1] for r in result if r and len(r) > 1 and r[1].strip()]
        return "\n".join(lines)
    except Exception:
        return ""


def ocr_from_pil(im) -> str:
    """PIL 图像 → 渲染成高质量 JPEG 再 OCR。"""
    from .config import OCR_SIZE
    from PIL import Image

    buf = io.BytesIO()
    rgb = im.convert("RGB")
    w, h = rgb.size
    scale = OCR_SIZE / max(w, h)
    if scale < 1:
        try:
            rs = Image.Resampling.LANCZOS
        except AttributeError:
            rs = Image.LANCZOS
        rgb = rgb.resize((int(w * scale + 0.5), int(h * scale + 0.5)), rs)
    rgb.save(buf, "JPEG", quality=88)
    return ocr_from_jpeg(buf.getvalue())


def ImageResample():
    try:
        from PIL import Image
        return Image.Resampling.LANCZOS
    except AttributeError:
        from PIL import Image
        return Image.LANCZOS
