// SPDX-License-Identifier: FSL-1.1-ALv2
// Initials avatar with the brand lime→pink gradient (matches the login/marketing
// accent). Pure presentational — safe in server or client components.

const SIZES = {
  sm: "h-8 w-8 text-[11px]",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-lg",
} as const;

/** Up to two initials from a name or email local-part. */
function initials(label: string): string {
  const base = (label || "").trim();
  if (!base) return "?";
  const namePart = base.includes("@") ? base.split("@")[0] : base;
  const parts = namePart.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  name,
  src,
  size = "md",
  square = false,
  className = "",
}: {
  name: string;
  /** Optional image (URL or data: URL). Falls back to initials when absent. */
  src?: string | null;
  size?: keyof typeof SIZES;
  /** Rounded-square (logos) instead of a circle (avatars). */
  square?: boolean;
  className?: string;
}) {
  const shape = square ? "rounded-lg" : "rounded-full";
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- data:/remote URL, not a static asset
      <img
        src={src}
        alt={name}
        className={`flex-shrink-0 object-cover ${shape} ${SIZES[size]} ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`inline-flex flex-shrink-0 items-center justify-center bg-gradient-to-br from-lime-500 to-pink-500 font-semibold text-white ${shape} ${SIZES[size]} ${className}`}
    >
      {initials(name)}
    </span>
  );
}
