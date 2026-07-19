/* ============================================================
 * image.js — 照片压缩
 * 选照片 → createImageBitmap 解码 → canvas 缩放（最长边 1280px）
 *        → JPEG 0.8 → base64 dataURL（同时用于大模型识别与 cardPhoto 存储）
 * ============================================================ */
const ImageUtil = (() => {
  /**
   * @param {File} file 相册/相机选中的图片
   * @param {number} maxEdge 最长边像素，默认 1280
   * @param {number} quality JPEG 质量，默认 0.8
   * @returns {Promise<string>} base64 dataURL（data:image/jpeg;base64,...）
   */
  async function compress(file, maxEdge = 1280, quality = 0.8) {
    // imageOrientation:'from-image' 让支持的浏览器按 EXIF 方向自动摆正；
    // 不支持的浏览器抛错则退回不带参数的解码
    let bmp;
    try {
      bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      bmp = await createImageBitmap(file);
    }
    // 等比缩放到最长边 maxEdge
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close && bmp.close(); // 释放位图内存

    return canvas.toDataURL('image/jpeg', quality);
  }

  return { compress };
})();
