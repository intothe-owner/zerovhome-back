export function makeWorkReportTitle(dongName?: string | null, residentName?: string | null) {
  return `${dongName ?? ""}${residentName ?? ""} 청소 보고서`.trim();
}

export function makeSafePdfFileName(title: string) {
  return `${title}.pdf`;
}

export function encodeRFC5987ValueChars(str: string) {
  return encodeURIComponent(str)
    .replace(/['()]/g, escape)
    .replace(/\*/g, "%2A")
    .replace(/%(?:7C|60|5E)/g, unescape);
}