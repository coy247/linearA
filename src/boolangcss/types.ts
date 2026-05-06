/** A single CSS declaration parsed from .blcss */
export interface CSSDecl {
  property: string;          // e.g. "color", "font-size", "z-index"
  rawValue: string;          // e.g. "bij6(r:4 g:3 b:5)", "ll(2)", "pg(1)"
  valueType: "bij6" | "ll" | "pg" | "fsm" | "raw";
  resolvedCSS: string;       // e.g. "#ab1234", "2em", "auto"
}

/** A CSS rule (.blcss) */
export interface BlcssRule {
  selector: string;
  decls: CSSDecl[];
}

/** One Linear A IR token: a sign group ONSET.BODY.CODA */
export interface LinearAToken {
  group:     string;          // e.g. "𐝫.𐘳.𐘽"
  fromState: string;          // leading sign's state
  toState:   string;          // trailing sign's state
  transition: string;         // "ONSET→BODY" etc.
  valid:     boolean;         // is this transition in VALID_TRANSITIONS?
  cssDecl:   CSSDecl;
}

/** One Voynich Machine Code instruction */
export interface VMCInstruction {
  opcode: string;             // EVA word: "daiin", "chedy", "dal", etc.
  args:   number[];           // canonical byte arguments
  comment: string;            // e.g. "color declaration"
}

/** Complete compiler output for one .blcss rule */
export interface CompilerOutput {
  rule:        BlcssRule;
  linearA:     LinearAToken[];
  vmc:         VMCInstruction[];
  css:         string;
  fsmScore:    number;        // proportion of valid transitions
  passes:      boolean;       // fsmScore >= FSM_THRESHOLD
}
