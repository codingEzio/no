import cactusFontFaces from "./cactus_font_faces.json" with { type: "json" };
export type FontDelivery = "bundled";
export type FontFallback = "Compact" | "System";
export type FontRole = "body" | "dense" | "technical" | "display";
export type BundledFontFace = {
  family: string;
  /** Relative to the product-owned fonts directory; never an installed face. */
  path: string;
  format: "woff2" | "truetype";
  weight: string;
  unicodeRange?: string;
  style?: "normal" | "italic";
};
export type FontArsenalEntry = {
  id: string;
  preference: string;
  label: string;
  role: "fallback" | "global-candidate" | "retained-asset" | "pairing-face";
  delivery: FontDelivery;
  sourceBytes: number;
  cssFamily: string;
  attribution?: string;
};
type FontAssetGroup =
  & Omit<FontArsenalEntry, "preference" | "delivery" | "cssFamily">
  & {
    order: number;
    faces: readonly BundledFontFace[];
  };
type FontChoiceDefinition = {
  id: string;
  label: string;
  detail: string;
  cssFamily: string;
  cjkFamily: string;
  denseFamily: string;
  technicalFamily: string;
  roleVariations?: Partial<Record<FontRole, string>>;
  displayFamily?: string;
  /** Display-only platform CJK faces; body/controls keep their own cascade. */
  displayCjkFamilies?: readonly string[];
  /** A minimum readable weight is a face property, not a family-name check. */
  readableWeight?: number;
  displayWeight?: number;
  headingWeight?: number;
  /** Expressive text faces may also style record titles; dot/pixel accents may not. */
  contentDisplay?: boolean;
  cjkCoverage: "bundled" | "platform";
  fallback: FontFallback;
  assets: readonly FontAssetGroup[];
};

/** One preset entry owns its roles and any new faces. Shared faces are referenced
 * by family; registration and inventory deduplicate them across presets. */
export const fontCatalog = [
  {
    id: "compact",
    label: "DeparturePixelZh Compact",
    detail: "",
    cssFamily: "Compact",
    cjkFamily: "Compact",
    denseFamily: "Compact",
    technicalFamily: "Compact",
    cjkCoverage: "bundled",
    fallback: "Compact",
    assets: [{
      id: "departure-pixel-zh-compact",
      label: "DeparturePixelZh Compact",
      role: "fallback",
      sourceBytes: 1_389_672,
      order: 1,
      faces: [{
        family: "Compact",
        path: "compact/DeparturePixelZhCompact-Regular.woff2",
        format: "woff2",
        weight: "400",
      }],
    }],
  },
  {
    id: "doto-sans",
    label: "Doto Sans",
    detail: "",
    cssFamily: "Doto",
    cjkFamily: "Prometheus Roboto",
    denseFamily: "Doto",
    technicalFamily: "Doto",
    readableWeight: 700,
    cjkCoverage: "platform",
    fallback: "System",
    assets: [{
      id: "doto",
      label: "Doto",
      role: "global-candidate",
      sourceBytes: 456_924,
      order: 2,
      faces: [{
        family: "Doto",
        path: "doto/Doto-Variable.ttf",
        format: "truetype",
        weight: "100 900",
      }],
    }],
  },
  {
    id: "roboto-sans",
    label: "Roboto Sans",
    detail: "",
    cssFamily: "Prometheus Roboto",
    cjkFamily: "Prometheus Roboto",
    denseFamily: "Prometheus Roboto Condensed",
    technicalFamily: "Prometheus Roboto Mono",
    cjkCoverage: "platform",
    fallback: "System",
    assets: [{
      id: "roboto-combo",
      label: "Roboto",
      role: "global-candidate",
      sourceBytes: 492_144,
      order: 3,
      faces: [
        {
          family: "Prometheus Roboto",
          path: "roboto/Roboto.woff2",
          format: "woff2",
          weight: "100 900",
        },
        {
          family: "Prometheus Roboto Condensed",
          path: "roboto/RobotoCondensed.woff2",
          format: "woff2",
          weight: "100 900",
        },
        {
          family: "Prometheus Roboto Mono",
          path: "roboto/RobotoMono.woff2",
          format: "woff2",
          weight: "100 900",
        },
      ],
    }],
  },
  {
    id: "system-mono",
    label: "System Mono",
    detail: "",
    cssFamily: "ui-monospace",
    cjkFamily: "PingFang TC",
    denseFamily: "ui-monospace",
    technicalFamily: "ui-monospace",
    cjkCoverage: "platform",
    fallback: "System",
    assets: [],
  },
  {
    id: "nothing",
    label: "Nothing",
    detail: "Doto 800 · DeparturePixelZh Compact · Geist Mono",
    cssFamily: "Compact",
    cjkFamily: "Compact",
    denseFamily: "Compact",
    technicalFamily: "Prometheus Geist Mono",
    displayFamily: "Doto",
    roleVariations: { display: '"wght" 800, "ROND" 0' },
    displayWeight: 800,
    headingWeight: 400,
    cjkCoverage: "bundled",
    fallback: "Compact",
    assets: [
      {
        id: "geist",
        label: "Geist",
        role: "global-candidate",
        sourceBytes: 69_760,
        order: 5,
        faces: [{
          family: "Prometheus Geist",
          path: "geist/Geist-Variable.woff2",
          format: "woff2",
          weight: "100 900",
        }],
      },
      {
        id: "geist-mono",
        label: "Geist Mono",
        role: "pairing-face",
        sourceBytes: 71_596,
        order: 6,
        faces: [{
          family: "Prometheus Geist Mono",
          path: "geist/GeistMono-Variable.woff2",
          format: "woff2",
          weight: "100 900",
        }],
      },
    ],
  },
  {
    id: "geist-pixel",
    label: "Pixel",
    detail: "Geist Pixel Square",
    cssFamily: "Prometheus Geist Pixel",
    cjkFamily: "PingFang TC",
    denseFamily: "Prometheus Geist Pixel",
    technicalFamily: "Prometheus Geist Pixel",
    cjkCoverage: "platform",
    fallback: "System",
    assets: [{
      id: "geist-pixel-square",
      label: "Geist Pixel Square",
      role: "global-candidate",
      sourceBytes: 28_288,
      order: 7,
      faces: [{
        family: "Prometheus Geist Pixel",
        path: "geist-pixel/GeistPixel-Square.woff2",
        format: "woff2",
        weight: "400",
      }],
    }],
  },
  {
    id: "nothing-geist-pixel",
    label: "Geist + Pixel",
    detail: "Geist Pixel · Geist · Geist Mono",
    cssFamily: "Prometheus Geist",
    cjkFamily: "PingFang TC",
    denseFamily: "Prometheus Geist",
    technicalFamily: "Prometheus Geist Mono",
    displayFamily: "Prometheus Geist Pixel",
    cjkCoverage: "platform",
    fallback: "System",
    // Reuse the existing Geist and standalone Pixel assets exactly once.
    assets: [],
  },
  {
    id: "editorial",
    label: "Editorial",
    detail: "Manrope · Fraunces · Cactus Classical Serif · Courier Prime",
    cssFamily: "Prometheus Manrope",
    cjkFamily: "Prometheus Cactus Classical Serif",
    denseFamily: "Prometheus Manrope",
    technicalFamily: "Prometheus Courier Prime",
    displayFamily: "Prometheus Fraunces",
    displayCjkFamilies: [
      "Prometheus Cactus Classical Serif",
      "Songti TC",
      "Songti SC",
      "Noto Serif CJK TC",
      "Noto Serif CJK SC",
      "Noto Serif CJK JP",
    ],
    displayWeight: 700,
    headingWeight: 700,
    contentDisplay: true,
    cjkCoverage: "bundled",
    fallback: "System",
    assets: [
      {
        id: "fraunces",
        label: "Fraunces",
        role: "pairing-face",
        sourceBytes: 430248,
        order: 8,
        faces: [
          {
            family: "Prometheus Fraunces",
            path: "editorial/Fraunces.woff2",
            format: "woff2",
            weight: "100 900",
          },
          {
            family: "Prometheus Fraunces",
            path: "editorial/Fraunces-Italic.woff2",
            format: "woff2",
            weight: "100 900",
            style: "italic",
          },
        ],
      },
      {
        id: "manrope",
        label: "Manrope",
        role: "global-candidate",
        sourceBytes: 53716,
        order: 9,
        faces: [{
          family: "Prometheus Manrope",
          path: "editorial/Manrope.woff2",
          format: "woff2",
          weight: "200 800",
        }],
      },
      {
        id: "cactus-classical-serif",
        label: "Cactus Classical Serif",
        role: "pairing-face",
        sourceBytes: 3260464,
        order: 11,
        faces: cactusFontFaces as readonly BundledFontFace[],
      },
      {
        id: "courier-prime",
        label: "Courier Prime",
        role: "pairing-face",
        sourceBytes: 144044,
        order: 12,
        faces: [
          {
            family: "Prometheus Courier Prime",
            path: "courier-prime/CourierPrime-Regular.ttf",
            format: "truetype",
            weight: "400",
          },
          {
            family: "Prometheus Courier Prime",
            path: "courier-prime/CourierPrime-Bold.ttf",
            format: "truetype",
            weight: "700",
          },
        ],
      },
    ],
  },
  {
    id: "studio",
    label: "Studio",
    detail: "Space Grotesk · Geist · Geist Mono",
    cssFamily: "Prometheus Geist",
    cjkFamily: "PingFang TC",
    denseFamily: "Prometheus Space Grotesk",
    technicalFamily: "Prometheus Geist Mono",
    displayFamily: "Prometheus Space Grotesk",
    displayWeight: 650,
    headingWeight: 650,
    contentDisplay: true,
    cjkCoverage: "platform",
    fallback: "System",
    assets: [{
      id: "space-grotesk",
      label: "Space Grotesk",
      role: "pairing-face",
      sourceBytes: 49304,
      order: 10,
      faces: [{
        family: "Prometheus Space Grotesk",
        path: "studio/SpaceGrotesk.woff2",
        format: "woff2",
        weight: "300 700",
      }],
    }],
  },
  {
    id: "system-ui",
    label: "System UI",
    detail: "System sans · Platform CJK · System Mono",
    cssFamily: "system-ui",
    cjkFamily: "PingFang TC",
    denseFamily: "system-ui",
    technicalFamily: "ui-monospace",
    headingWeight: 600,
    displayWeight: 600,
    cjkCoverage: "platform",
    fallback: "System",
    assets: [],
  },
  {
    id: "bootstrap",
    label: "System UI",
    detail: "System sans · Platform CJK · System Mono",
    cssFamily: "system-ui",
    cjkFamily: "PingFang TC",
    denseFamily: "system-ui",
    technicalFamily: "ui-monospace",
    headingWeight: 600,
    displayWeight: 600,
    cjkCoverage: "platform",
    fallback: "System",
    assets: [],
  },
] as const satisfies readonly FontChoiceDefinition[];

export type FontPreference = typeof fontCatalog[number]["id"] | "theme-default";
export type GlobalFontChoice = Omit<FontChoiceDefinition, "id" | "assets"> & {
  id: FontPreference;
};
// Retained IDs keep historical preferences interpretable. Live UI uses Themes.
export const fontChoices: readonly GlobalFontChoice[] = [
  {
    ...fontCatalog[9],
    id: "theme-default",
    label: "Theme default",
    detail: "Follows the selected theme",
  },
  ...fontCatalog.filter((choice) =>
    !["compact", "doto-sans", "geist-pixel"].includes(choice.id)
  ),
  {
    ...fontCatalog[5],
    label: "Geist Pixel + Compact",
    detail: "Geist Pixel · DeparturePixelZh Compact",
    cjkFamily: "Compact",
    cjkCoverage: "bundled",
    fallback: "Compact",
    headingWeight: 400,
    displayWeight: 400,
    technicalFamily: "Prometheus Geist Mono",
  },
  fontCatalog[0],
  {
    ...fontCatalog[1],
    label: "Doto + Compact",
    detail: "Doto 800 · DeparturePixelZh Compact",
    cjkFamily: "Compact",
    readableWeight: 800,
    headingWeight: 800,
    displayWeight: 800,
    cjkCoverage: "bundled",
    fallback: "Compact",
    technicalFamily: "Prometheus Geist Mono",
  },
];
/** Font families are owned by Themes, with no independent family controls. */
export const fontPickerChoices: readonly GlobalFontChoice[] = [];
export const readerFontChoices: readonly GlobalFontChoice[] = [];
export const globalFontPreferences = fontChoices.map((choice) => choice.id);
export const fontChoiceById = new Map(
  fontChoices.map((font) => [font.id, font]),
);

const retainedAssets: readonly (FontAssetGroup & { preference: string })[] = [{
  id: "jetbrains-mono",
  preference: "jb-mono-sans",
  label: "JetBrains Mono",
  role: "retained-asset",
  sourceBytes: 21_212,
  order: 4,
  faces: [{
    family: "Prometheus JetBrains Mono",
    path: "jetbrainsmono/jetbrainsmono.woff2",
    format: "woff2",
    weight: "400",
  }],
}];
const assetGroups = [
  ...fontCatalog.flatMap((choice) =>
    choice.assets.map((asset) => ({ ...asset, preference: choice.id }))
  ),
  ...retainedAssets,
].sort((a, b) => a.order - b.order);
export const fontArsenal: readonly FontArsenalEntry[] = assetGroups.map((
  asset,
) => ({
  id: asset.id,
  preference: asset.preference,
  label: asset.label,
  role: asset.role,
  delivery: "bundled",
  sourceBytes: asset.sourceBytes,
  cssFamily: asset.faces[0].family,
}));
export const bundledFontFaces: readonly BundledFontFace[] = [...new Map(
  assetGroups.flatMap((asset) => asset.faces).map((
    face,
  ) => [`${face.family}:${face.path}`, face]),
).values()];

/** One recipe supplies the complete product, including all reading surfaces. */
export const toneDefaultFonts = {
  nothing: "nothing",
  editorial: "editorial",
} as const satisfies Record<string, FontPreference>;

/** Rendering ignores retired font overrides without changing their saved bytes. */
export function resolveThemeFontPreference(tone: unknown): FontPreference {
  return tone === "editorial"
    ? toneDefaultFonts.editorial
    : toneDefaultFonts.nothing;
}

/** Resolve inheritance without changing the saved preference or font catalog. */
export function resolveFontPreference(
  value: unknown,
  tone: unknown,
): FontPreference {
  const preference = normalizeFontPreference(value);
  return preference === "theme-default"
    ? tone === "nothing" || tone === "editorial"
      ? toneDefaultFonts[tone]
      : toneDefaultFonts.nothing
    : preference;
}

export function fontChoiceFor(value: unknown): GlobalFontChoice {
  return fontChoiceById.get(normalizeFontPreference(value))!;
}
const cssQuote = (value: string) =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
const familyToken = (family: string) =>
  /^(?:ui-|system-ui$|-apple-system$|serif$|sans-serif$|monospace$)/.test(
      family,
    )
    ? family
    : cssQuote(family);
const systemSansFamilies = [
  "system-ui",
  "-apple-system",
  "BlinkMacSystemFont",
  "Segoe UI",
  "Roboto",
  "Helvetica Neue",
  "Arial",
];
const systemMonoFamilies = [
  "ui-monospace",
  "SFMono-Regular",
  "Menlo",
  "Monaco",
  "Consolas",
  "Liberation Mono",
  "Courier New",
];
const systemCjkFamilies = [
  "PingFang TC",
  "PingFang SC",
  "Hiragino Sans",
  "Yu Gothic UI",
  "Microsoft JhengHei",
  "Microsoft YaHei",
  "Malgun Gothic",
  "Noto Sans CJK TC",
  "Noto Sans CJK SC",
  "Noto Sans CJK JP",
  "Noto Sans CJK KR",
];
export type FontStackFallbacks = {
  emoji?: string;
  latin?: string;
  cjk?: string;
  mono?: string;
};
export function fontRoleStack(
  value: unknown,
  role: FontRole,
  fallbacks: FontStackFallbacks = {},
): string {
  const choice = fontChoiceFor(value);
  const selected = role === "dense"
    ? choice.denseFamily
    : role === "technical"
    ? choice.technicalFamily
    : role === "display"
    ? choice.displayFamily ?? choice.cssFamily
    : choice.cssFamily;
  if (selected === "system-ui" || selected === "ui-monospace") {
    const mono = selected === "ui-monospace";
    return [
      ...new Set([
        ...(mono ? systemMonoFamilies : systemSansFamilies).map(familyToken),
        familyToken(choice.cjkFamily),
        ...systemCjkFamilies.map(familyToken),
        fallbacks.emoji ?? "var(--emoji-font)",
        mono ? "monospace" : "sans-serif",
      ]),
    ].join(", ");
  }
  return [
    ...new Set([
      familyToken(selected),
      ...(role === "display"
        ? (choice.displayCjkFamilies ?? []).map(familyToken)
        : []),
      ...(role === "display" && selected !== choice.cssFamily
        ? [familyToken(choice.cssFamily)]
        : []),
      familyToken(choice.cjkFamily),
      fallbacks.emoji ?? "var(--emoji-font)",
      fallbacks.latin ?? "var(--system-latin)",
      fallbacks.cjk ?? "var(--system-cjk-sans)",
      fallbacks.mono ?? "var(--system-mono)",
    ]),
  ].join(", ");
}
export function fontRoleVariations(value: unknown, role: FontRole): string {
  return fontChoiceFor(value).roleVariations?.[role] ?? "normal";
}
export function fontRoleVariables(value: unknown): Record<string, string> {
  const choice = fontChoiceFor(value);
  return {
    "--selected-font": familyToken(choice.cssFamily),
    "--paired-font": familyToken(choice.cjkFamily),
    "--dense-font": familyToken(choice.denseFamily),
    "--technical-font": familyToken(choice.technicalFamily),
    "--font-stack": fontRoleStack(choice.id, "body"),
    "--dense-stack": fontRoleStack(choice.id, "dense"),
    "--technical-stack": fontRoleStack(choice.id, "technical"),
    "--body-variations": fontRoleVariations(choice.id, "body"),
    "--dense-variations": fontRoleVariations(choice.id, "dense"),
    "--display-variations": fontRoleVariations(choice.id, "display"),
    "--technical-variations": fontRoleVariations(choice.id, "technical"),
    "--display": fontRoleStack(choice.id, "display"),
    "--title": fontRoleStack(
      choice.id,
      choice.contentDisplay ? "display" : "body",
    ),
    "--heading-weight": String(choice.headingWeight ?? 700),
    "--display-weight": String(
      choice.displayWeight ?? choice.headingWeight ?? 700,
    ),
  };
}
/** Registration does not fetch all faces. The browser requests only used faces;
 * the selected-preset loader likewise excludes platform fallback families. */
export function fontFaceCss(baseUrl = "/fonts/"): string {
  return bundledFontFaces.map((face) =>
    `@font-face {\n  font-family: ${cssQuote(face.family)};\n  src: url(${
      cssQuote(baseUrl + face.path)
    }) format(${cssQuote(face.format)});\n  font-style: ${
      face.style ?? "normal"
    };\n  font-weight: ${face.weight};\n  font-display: swap;${
      face.unicodeRange ? `\n  unicode-range: ${face.unicodeRange};` : ""
    }\n}`
  ).join("\n");
}
export function fontLoadDescriptors(
  value: unknown,
): readonly { family: string; weight: number; sample: string }[] {
  const choice = fontChoiceFor(value);
  const used = new Map<string, number>([
    [choice.cssFamily, choice.readableWeight ?? 400],
    [choice.cjkFamily, choice.readableWeight ?? 400],
    [choice.denseFamily, choice.readableWeight ?? 400],
    [choice.technicalFamily, 400],
    ...(choice.displayFamily
      ? [
        [
          choice.displayFamily,
          choice.displayWeight ?? choice.readableWeight ?? 400,
        ] as [string, number],
      ]
      : []),
  ]);
  return [...used].filter(([family]) =>
    bundledFontFaces.some((face) => face.family === family)
  )
    .map(([family, weight]) => ({ family, weight, sample: "Aa09中" }));
}
const legacyFontPreferences: Record<string, FontPreference> = {
  paper: "theme-default",
  geist: "nothing",
  doto: "doto-sans",
  "doto-serif": "doto-sans",
  roboto: "roboto-sans",
  "roboto-serif": "roboto-sans",
  "jetbrains-mono": "compact",
  "jb-mono-serif": "compact",
  "jb-mono-sans": "compact",
  system: "system-ui",
};
export function normalizeFontPreference(value: unknown): FontPreference {
  if (typeof value !== "string") return "system-ui";
  const migrated = legacyFontPreferences[value] ?? value;
  return fontChoiceById.has(migrated as FontPreference)
    ? migrated as FontPreference
    : "system-ui";
}
export function isKnownFontPreference(value: unknown): value is FontPreference {
  return typeof value === "string" &&
    (fontChoiceById.has(value as FontPreference) ||
      Object.hasOwn(legacyFontPreferences, value));
}
export const typographyPreferenceVersion = "2";

/** Saved font choices survive presentation changes and earlier version markers. */
export function initialFontPreference(
  value: unknown,
  adopted: unknown,
): FontPreference {
  // Keep the argument for callers and existing stored metadata. It no longer
  // authorizes overwriting a saved face when a new presentation is introduced.
  void adopted;
  return value === null || value === undefined || value === ""
    ? "theme-default"
    : normalizeFontPreference(value);
}

export const fontArsenalSummary = {
  count: fontArsenal.length,
  sourceBytes: fontArsenal.reduce((sum, font) => sum + font.sourceBytes, 0),
  bundledCount:
    fontArsenal.filter((font) => font.delivery === "bundled").length,
  bundledBytes: fontArsenal.filter((font) => font.delivery === "bundled")
    .reduce((sum, font) => sum + font.sourceBytes, 0),
} as const;

export type ToneId = keyof typeof toneDefaultFonts;
/** Compatibility keys preserve independent fonts from retired themes. */
export type ToneFontOverrides = Partial<
  Record<ToneId | "bootstrap" | "xp", FontPreference>
>;
export const toneIds: readonly ToneId[] = [
  "nothing",
  "editorial",
];
export function validToneFontOverrides(
  value: unknown,
): value is ToneFontOverrides {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.entries(value).every(([tone, font]) =>
      [...toneIds, "bootstrap", "xp"].includes(tone) &&
      typeof font === "string" && fontChoiceById.has(font as FontPreference)
    );
}
/** Only migrate recognized legacy values. Unknown raw storage stays untouched. */
export function initialToneFontOverrides(
  raw: unknown,
  legacyFont?: unknown,
  legacyTone?: unknown,
): ToneFontOverrides {
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = undefined;
    }
  }
  const retired = normalizeRetiredFontOverrides(raw, legacyTone);
  if (retired !== raw) raw = retired;
  if (validToneFontOverrides(raw)) {
    const overrides = { ...raw };
    if (legacyTone === "bootstrap" || legacyTone === "xp") {
      overrides.nothing ??= overrides[legacyTone];
    }
    return overrides;
  }
  const tone: ToneId = toneIds.includes(legacyTone as ToneId)
    ? legacyTone as ToneId
    : "nothing";
  const known = isKnownFontPreference(legacyFont);
  return known && legacyFont !== "theme-default"
    ? { [tone]: normalizeFontPreference(legacyFont) }
    : {};
}
/** Remove only the withdrawn Paper recipe, retaining independent font choices. */
export function normalizeRetiredFontOverrides(
  raw: unknown,
  originalTone?: unknown,
): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const entries = Object.entries(raw);
  if (!entries.some(([tone, font]) => tone === "paper" || font === "paper")) {
    return raw;
  }
  const normalized = Object.fromEntries(
    entries.filter(([tone]) => tone !== "paper").map((
      [tone, font],
    ) => [tone, font === "paper" ? "theme-default" : font]),
  );
  const independent = (raw as Record<string, unknown>).paper;
  if (
    originalTone === "paper" && independent !== "paper" &&
    independent !== "theme-default" && isKnownFontPreference(independent) &&
    !Object.hasOwn(normalized, "nothing")
  ) {
    normalized.nothing = normalizeFontPreference(independent);
  }
  return normalized;
}
/** Keep inheritance explicit so clicking an already selected Tone can reset it. */
export function resolveToneFontPreference(
  overrides: ToneFontOverrides,
  tone: unknown,
): FontPreference {
  const id: ToneId = toneIds.includes(tone as ToneId)
    ? tone as ToneId
    : "nothing";
  return overrides[id] ?? "theme-default";
}
