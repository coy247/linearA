const REPO_ROOT = decodeURIComponent(new URL("../../", import.meta.url).pathname);

// CSS properties in priority order — assigned to ONSET signs by frequency rank
const CSS_PROPERTIES = [
  "color", "background", "display", "margin", "padding",
  "font-size", "width", "height", "flex", "border",
  "transition", "opacity", "transform", "z-index", "position",
  "overflow", "cursor", "text-align", "line-height", "font-weight",
];

// CSS units assigned to CODA signs by frequency rank
const CSS_UNITS = ["px", "em", "%", "rem", "vh", "vw", "pt", "auto", "none", ""];

export interface SignEntry {
  sign:          string;
  compactIndex:  number;
  canonicalByte: number | null;
  positionBias:  string;
  freqTotal:     number;
}

export interface SignMap {
  propertyToSign: Map<string, string>;   // CSS property → ONSET sign
  signToProperty: Map<string, string>;   // ONSET sign → CSS property
  unitToSign:     Map<string, string>;   // CSS unit → CODA sign
  signToUnit:     Map<string, string>;   // CODA sign → CSS unit
  bodySign:       string;                // first BODY sign (default value carrier)
  allSigns:       SignEntry[];
}

export function loadSignMap(): SignMap {
  const raw = Deno.readTextFileSync(`${REPO_ROOT}corpus/analysis/sign-frequency.json`);
  const signs = JSON.parse(raw) as SignEntry[];

  const onsetSigns = signs.filter(s => s.positionBias === "ONSET");
  const bodySigns  = signs.filter(s => s.positionBias === "BODY");
  const codaSigns  = signs.filter(s => s.positionBias === "CODA");

  const propertyToSign = new Map<string, string>();
  const signToProperty = new Map<string, string>();
  for (let i = 0; i < CSS_PROPERTIES.length && i < onsetSigns.length; i++) {
    propertyToSign.set(CSS_PROPERTIES[i], onsetSigns[i].sign);
    signToProperty.set(onsetSigns[i].sign, CSS_PROPERTIES[i]);
  }

  const unitToSign = new Map<string, string>();
  const signToUnit = new Map<string, string>();
  for (let i = 0; i < CSS_UNITS.length && i < codaSigns.length; i++) {
    unitToSign.set(CSS_UNITS[i], codaSigns[i].sign);
    signToUnit.set(codaSigns[i].sign, CSS_UNITS[i]);
  }

  return {
    propertyToSign,
    signToProperty,
    unitToSign,
    signToUnit,
    bodySign: bodySigns[0]?.sign ?? "𐘳",
    allSigns: signs,
  };
}
