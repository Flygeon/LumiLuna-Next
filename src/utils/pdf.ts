/**
 * pdf.js 的共享入口：统一 worker 配置，避免各处重复设置导致
 * worker 与主包版本不一致。
 */
let pdfjsPromise: Promise<any> | null = null;

export function loadPdfjs(): Promise<any> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs: any = await import("pdfjs-dist");
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url"))
        .default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

/** 把 Uint8Array 拷贝成独立 ArrayBuffer（pdf.js 会接管并 detach 传入缓冲区） */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

/**
 * 渲染 PDF 首页为 JPEG 字节，用作书籍封面。
 * 后端没有轻量的纯 Rust PDF 栅格化方案，复用前端已打包的 pdf.js。
 */
export async function renderPdfCover(
  data: ArrayBuffer,
  target = 320,
): Promise<Uint8Array | null> {
  const pdfjs = await loadPdfjs();
  // destroy() 在 loadingTask 上，PDFDocumentProxy 本身没有该方法
  const loadingTask = pdfjs.getDocument({ data });
  const doc = await loadingTask.promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    // 让长边贴合目标尺寸
    const scale = target / Math.max(base.width, base.height);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // PDF 多为透明背景，先铺白底否则转 JPEG 后会变黑
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82),
    );
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    void loadingTask.destroy();
  }
}
