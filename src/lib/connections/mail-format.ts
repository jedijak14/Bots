/** Strict single-recipient addresses, with no header injection or implicit CC/BCC. */
export function validRecipient(value: string) {
  return value.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(value);
}
export function validateDraft(recipient: string, subject: string, body: string): string | null {
  if (!validRecipient(recipient)) return "Enter one valid recipient email address.";
  if (!subject.trim() || subject.length > 200 || /[\r\n]/.test(subject)) return "Enter a single-line subject (up to 200 characters).";
  if (!body.trim() || body.length > 20_000) return "Enter a message (up to 20,000 characters).";
  return null;
}
export function mimeMessage(recipient: string, subject: string, body: string) {
  const chunks: string[] = [];
  let chunk = "";
  for (const char of subject) {
    if (Buffer.byteLength(chunk + char, "utf8") > 30 && chunk) { chunks.push(chunk); chunk = ""; }
    chunk += char;
  }
  if (chunk) chunks.push(chunk);
  const encodedSubject = chunks.map((part) => `=?UTF-8?B?${Buffer.from(part, "utf8").toString("base64")}?=`).join("\r\n ");
  return Buffer.from(`To: ${recipient}\r\nSubject: ${encodedSubject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(body, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n")}`, "utf8").toString("base64url");
}
