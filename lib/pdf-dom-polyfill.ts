// DOM globals that pdf.js needs and Node doesn't have.
//
// pdf.js tries to polyfill these itself by `require`-ing @napi-rs/canvas inside
// a try/catch. That dynamic require is invisible to Vercel's file tracer, so the
// native package never ships in the deployed function, the polyfill silently
// fails, and importing pdf.js throws "DOMMatrix is not defined" at module load.
// It works locally only because the package is present in node_modules there.
//
// The static import below is traceable, so the package actually gets deployed,
// and assigning the globals here means we no longer depend on pdf.js's require
// fallback working at all.
//
// This lives in its own module for a reason: ES imports are hoisted, so doing
// it inline in lib/pdf.ts would run AFTER pdf-parse was already evaluated.
// Module evaluation follows import order, so importing this first is what
// guarantees the globals exist before pdf.js reads them at its module scope.

import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";

const g = globalThis as Record<string, unknown>;
g.DOMMatrix ??= DOMMatrix;
g.ImageData ??= ImageData;
g.Path2D ??= Path2D;
