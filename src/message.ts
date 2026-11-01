// Telegram 單則訊息上限 4096 字，留一點餘裕
export const TELEGRAM_LIMIT = 4000;

export const BLOCK_SEPARATOR = "\n━━━━━━━━━━\n";

/** 依 Telegram 長度上限把 blocks 切成多則訊息，不會把單一 block 拆開 */
export function splitMessages(blocks: string[], separator = BLOCK_SEPARATOR): string[] {
  const messages: string[] = [];
  let current = "";
  for (const block of blocks) {
    const next = current ? `${current}${separator}${block}` : block;
    if (next.length > TELEGRAM_LIMIT && current) {
      messages.push(current);
      current = block;
    } else {
      current = next;
    }
  }
  if (current) messages.push(current);
  return messages;
}
