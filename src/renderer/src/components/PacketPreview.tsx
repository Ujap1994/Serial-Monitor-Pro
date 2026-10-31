import type { ReactNode } from 'react';
import { toHexString } from '@shared/core/bytes';
import type { TransmitPacket } from '@shared/core/transmit-crc';
import { useT } from '../lib/i18n';

type Part = 'header' | 'data' | 'crc' | 'footer' | 'newline';

/** Packet bytes as HEX, coloured by part (header, data, CRC, footer, line ending). */
export function PacketPreview({
  packet,
  testId,
  legend,
}: {
  packet: TransmitPacket;
  testId?: string;
  legend?: boolean;
}): ReactNode {
  const t = useT();
  const parts: [Part, Uint8Array][] = [];
  const push = (part: Part, bytes: Uint8Array): void => {
    if (bytes.length) parts.push([part, bytes]);
  };
  push('header', packet.header);
  if (packet.crc) {
    push('data', packet.body.subarray(0, packet.index));
    push('crc', packet.crc);
    push('data', packet.body.subarray(packet.index + packet.crc.length));
  } else {
    push('data', packet.body);
  }
  push('footer', packet.footer);
  push('newline', packet.newline);
  const used = new Set(parts.map(([part]) => part));
  return (
    <>
      <span className="packet" data-testid={testId}>
        {parts.map(([part, bytes], i) => (
          <span key={i}>
            {i > 0 && ' '}
            <span className={`pk pk-${part}`} title={t(`crc.part.${part}`)}>
              {toHexString(bytes)}
            </span>
          </span>
        ))}
      </span>
      {legend && (
        <span className="packet-legend">
          {(['header', 'data', 'crc', 'footer', 'newline'] as const)
            .filter((part) => used.has(part))
            .map((part) => (
              <span key={part} className={`pk pk-${part}`}>
                {t(`crc.part.${part}`)}
              </span>
            ))}
        </span>
      )}
    </>
  );
}
