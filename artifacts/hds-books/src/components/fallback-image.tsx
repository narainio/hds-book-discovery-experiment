import React, { useState } from 'react';

/** Original image with a soft colored block if it fails to load. */
export function FallbackImage({ src, alt, color, className }: { src: string; alt: string; color: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div role={alt ? 'img' : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true} className={className} style={{ backgroundColor: color }} data-testid="img-fallback" />;
  return <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} className={className} style={{ backgroundColor: color }} />;
}
