import { PDFDocument } from 'pdf-lib';

export async function mergePdfs(buffers: Buffer[]): Promise<Buffer> {
  if (buffers.length === 0) throw new Error('No PDFs to merge');
  if (buffers.length === 1) return buffers[0];

  const merged = await PDFDocument.create();
  for (const buf of buffers) {
    const doc   = await PDFDocument.load(buf);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach(p => merged.addPage(p));
  }
  return Buffer.from(await merged.save());
}
