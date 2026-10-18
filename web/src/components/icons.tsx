// Minimal line icon set (24px grid, 1.75 stroke), drawn for RELIEFOS.
import type { SVGProps } from 'react';

const base = (d: React.ReactNode) =>
  function Icon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {d}
      </svg>
    );
  };

export const IconOverview = base(
  <>
    <rect x="3" y="3" width="7" height="9" rx="1" />
    <rect x="14" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="12" width="7" height="9" rx="1" />
    <rect x="3" y="16" width="7" height="5" rx="1" />
  </>,
);
export const IconCart = base(
  <>
    <path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.5L21 8H6.2" />
    <circle cx="10" cy="20" r="1.3" />
    <circle cx="17" cy="20" r="1.3" />
  </>,
);
export const IconEvidence = base(
  <>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h6M9 17h4" />
  </>,
);
export const IconGrid = base(
  <>
    <rect x="3" y="4" width="18" height="16" rx="1.5" />
    <path d="M3 9h18M3 14h18M9 4v16" />
  </>,
);
export const IconSchedule = base(
  <>
    <rect x="3" y="5" width="18" height="16" rx="1.5" />
    <path d="M16 3v4M8 3v4M3 10h18" />
    <path d="M7 14h5M10 17h6" />
  </>,
);
export const IconShield = base(
  <>
    <path d="M12 3l8 3v6c0 4.5-3.3 8.3-8 9-4.7-.7-8-4.5-8-9V6z" />
    <path d="M9 12l2 2 4-4" />
  </>,
);
export const IconCard = base(
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 10h18M7 15h4" />
  </>,
);
export const IconLedger = base(
  <>
    <path d="M5 3h11l3 3v15H5z" />
    <path d="M9 8h6M9 12h6M9 16h3" />
  </>,
);
export const IconReport = base(
  <>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </>,
);
export const IconPlug = base(
  <>
    <path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0z" />
    <path d="M12 16v5" />
  </>,
);
export const IconPlus = base(<path d="M12 5v14M5 12h14" />);
export const IconCheck = base(<path d="M5 12.5l4.2 4.2L19 7" />);
export const IconX = base(<path d="M6 6l12 12M18 6L6 18" />);
export const IconAlert = base(
  <>
    <path d="M12 3l9.5 17h-19z" />
    <path d="M12 10v4M12 17.5v.01" />
  </>,
);
export const IconInfo = base(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8v.01" />
  </>,
);
export const IconRefresh = base(
  <>
    <path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" />
    <path d="M4 4v4h4" />
    <path d="M4 13a8 8 0 0 0 14.6 4.5L20 16" />
    <path d="M20 20v-4h-4" />
  </>,
);
export const IconBolt = base(<path d="M13 3L4 14h7l-1 7 9-11h-7z" />);
export const IconEdit = base(
  <>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
    <path d="M14 6l4 4" />
  </>,
);
export const IconExternal = base(
  <>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </>,
);
export const IconList = base(<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />);
