/**
 * Hand-drawn "evening at the shore" sketch used on the landing hero.
 * All ink strokes — no assets, pure SVG.
 */
export function BeachSketch({ className = "" }: { className?: string }) {
  const ink = "#26324f";
  const blue = "#3d6fb5";
  const red = "#c0392b";
  const pencil = "#7d8598";

  return (
    <svg
      viewBox="0 0 480 360"
      className={className}
      role="img"
      aria-label="Hand-drawn sketch of Juhu Beach at sunset with waves, skyline, palms and a walker"
    >
      {/* ---- sun + rays ---- */}
      <circle cx="352" cy="96" r="34" fill="#ffe9a8" opacity="0.9" />
      <path
        d="M352 62 q 6 -12 -3 -22 M386 84 q 14 -4 20 -14 M384 116 q 14 6 16 18 M318 74 q -10 -8 -20 -6 M320 120 q -12 6 -14 16"
        stroke={red}
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M352 62 a 34 34 0 1 1 -0.1 0"
        stroke={red}
        strokeWidth="2.6"
        fill="none"
        strokeLinecap="round"
      />

      {/* ---- clouds ---- */}
      <path
        d="M40 64 q 10 -16 30 -12 q 8 -14 28 -10 q 20 -6 26 10 q 18 2 12 16 q -8 10 -26 8 q -16 8 -34 2 q -26 4 -36 -14"
        stroke={pencil}
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M180 42 q 8 -12 24 -9 q 14 -8 24 4 q 14 0 10 12"
        stroke={pencil}
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />

      {/* ---- birds ---- */}
      <path
        d="M110 96 q 7 -8 14 0 q 7 -8 14 0 M150 78 q 6 -7 12 0 q 6 -7 12 0 M92 122 q 5 -6 10 0 q 5 -6 10 0"
        stroke={ink}
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
      />

      {/* ---- horizon ---- */}
      <path
        d="M8 176 q 60 -5 120 -1 t 120 0 t 120 -2 t 104 3"
        stroke={ink}
        strokeWidth="2.6"
        fill="none"
        strokeLinecap="round"
      />

      {/* ---- tanker on the horizon ---- */}
      <path
        d="M52 168 l 46 0 l -6 8 l -34 0 z M64 168 l 0 -8 l 8 0 l 0 8 M76 160 l 10 0"
        stroke={ink}
        strokeWidth="2.2"
        fill="none"
        strokeLinejoin="round"
      />

      {/* ---- sea: rolling wave lines ---- */}
      <g stroke={blue} strokeWidth="2.4" fill="none" strokeLinecap="round">
        <path d="M12 194 q 16 -9 32 0 t 32 0 t 32 0 t 32 0 t 32 0 t 32 0 t 32 0 t 32 0 t 32 0 t 32 0 t 32 0" />
        <path d="M28 214 q 14 -8 28 0 t 28 0 t 28 0 t 28 0 t 28 0 t 28 0 t 28 0 t 28 0 t 28 0 t 28 0 t 28 0 t 28 0" opacity="0.8" />
        <path d="M10 236 q 18 -8 36 0 t 36 0 t 36 0 t 36 0 t 36 0 t 36 0 t 36 0 t 36 0 t 36 0 t 36 0 t 36 0" opacity="0.6" />
        <path d="M40 256 q 15 -7 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0" opacity="0.45" />
      </g>

      {/* ---- beach ---- */}
      <path
        d="M0 274 q 80 -12 160 -6 q 90 6 180 -2 q 80 -6 140 4"
        stroke={ink}
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
      />
      {/* sand stipple */}
      <g fill={pencil} opacity="0.65">
        {[
          [30, 292],
          [74, 306],
          [122, 288],
          [176, 314],
          [218, 294],
          [264, 322],
          [310, 300],
          [356, 330],
          [404, 302],
          [446, 326],
          [96, 334],
          [150, 344],
          [244, 348],
          [334, 352],
          [420, 354],
        ].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="1.6" />
        ))}
      </g>

      {/* ---- umbrella + towel ---- */}
      <path
        d="M74 322 l 0 -46"
        stroke={ink}
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="M40 278 q 17 -26 34 -2 q 16 -24 34 2 q -34 8 -68 0 z"
        fill="#ffd9cf"
        stroke={red}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path
        d="M104 330 l 54 -6 l 6 22 l -54 6 z"
        fill="#d7ecf3"
        stroke={blue}
        strokeWidth="2.2"
        strokeLinejoin="round"
      />

      {/* ---- palms on the right ---- */}
      <g stroke={ink} fill="none" strokeWidth="2.6" strokeLinecap="round">
        <path d="M430 318 q -6 -46 6 -84" />
        <path d="M436 234 q -22 -18 -44 -12 q 16 -16 40 -8 M436 234 q 16 -22 40 -20 q -18 -14 -40 4 M436 234 q 22 -6 34 12 q -24 -4 -34 -12 M436 234 q -20 4 -26 26 q 16 -14 26 -26" />
        <path d="M468 316 q -4 -30 4 -54" strokeWidth="2.2" />
        <path d="M472 262 q -14 -12 -30 -8 q 12 -12 28 -4 q 12 -4 22 8" strokeWidth="2.2" />
      </g>

      {/* ---- Mumbai skyline behind ---- */}
      <g stroke={ink} strokeWidth="2.4" fill="none" strokeLinejoin="round">
        <path d="M262 176 l 0 -44 l 30 0 l 0 44" />
        <path d="M292 176 l 0 -64 l 26 0 l 0 64" />
        <path d="M318 176 l 0 -34 l 24 0 l 0 34" />
        <path d="M400 176 l 0 -52 l 30 0 l 0 52" />
        <path d="M430 176 l 0 -78 l 26 0 l 0 78" />
        <path d="M456 176 l 0 -40 l 22 0 l 0 40" />
        <path d="M270 146 l 6 0 M270 156 l 6 0 M300 128 l 8 0 M300 140 l 8 0 M300 152 l 8 0 M408 138 l 10 0 M408 150 l 10 0 M438 110 l 10 0 M438 124 l 10 0 M438 138 l 10 0" strokeWidth="1.8" />
      </g>
      {/* rooftop hatching */}
      <g stroke={pencil} strokeWidth="1.6" opacity="0.8">
        <path d="M266 140 l 20 -18 M274 142 l 18 -16 M434 104 l 18 -16 M442 106 l 16 -14" />
      </g>

      {/* ---- walking figure with a notebook ---- */}
      <g stroke={ink} strokeWidth="2.8" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="232" cy="286" r="8" fill="#ffe9a8" />
        <path d="M232 294 l 0 24 M232 300 l -12 10 M232 300 l 12 8 M232 318 l -10 18 M232 318 l 11 17" />
        <rect x="240" y="302" width="12" height="9" rx="1.5" fill="#fdf9ec" strokeWidth="2" />
      </g>
      {/* long sunset shadow */}
      <path
        d="M224 338 q -18 6 -34 4"
        stroke={pencil}
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.55"
        fill="none"
      />

      {/* ---- red annotation: circle the sun ---- */}
      <path
        d="M312 70 q 40 -30 78 -4 q 30 26 -6 50 q -44 24 -76 -8 q -22 -24 4 -38"
        stroke={red}
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
        strokeDasharray="1 7"
        opacity="0.85"
      />

      {/* ---- labels ---- */}
      <text
        x="18"
        y="164"
        fill={blue}
        fontFamily="var(--font-hand)"
        fontSize="21"
        transform="rotate(-3 18 164)"
      >
        arabian sea
      </text>
      <text
        x="330"
        y="248"
        fill={ink}
        fontFamily="var(--font-hand)"
        fontSize="21"
        transform="rotate(-2 330 248)"
      >
        chaat row →
      </text>
      <text
        x="366"
        y="52"
        fill={red}
        fontFamily="var(--font-hand)"
        fontSize="21"
        transform="rotate(3 366 52)"
      >
        last light
      </text>
      <text
        x="18"
        y="352"
        fill={ink}
        fontFamily="var(--font-hand)"
        fontSize="22"
      >
        juhu beach, 6:40 pm
      </text>
      <path
        d="M18 358 q 60 6 148 2"
        stroke={red}
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
