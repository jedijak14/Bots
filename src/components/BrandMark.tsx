import { BRAND_PATHS } from "./brands";

/**
 * A real company logo.
 *
 * Uses the company's own mark rather than an approximation, drawn at a fixed
 * size from inlined path data. `label` is only needed when the mark is the
 * only thing naming the service.
 */
export function BrandMark({
  brand,
  size = 17,
  className,
  label,
}: {
  brand: string;
  size?: number;
  className?: string;
  label?: string;
}) {
  const path = BRAND_PATHS[brand];
  if (!path) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={path} />
    </svg>
  );
}

export const HAS_BRAND_MARK = (brand: string): boolean => brand in BRAND_PATHS;
