import { randomShortIdSuffix, SHORT_ID_ALPHABET } from "./shortId";

export const TAB_SLUG_TAIL_LENGTH = 4;

export const TAB_SLUG_ADJECTIVES = [
  "ablative", "abrasive", "accessible", "accurate", "active", "adaptive", "adhesive", "advanced", "aerodynamic", "algorithmic",
  "ambient", "amorphous", "analog", "angular", "anisotropic", "annealed", "anodized", "arcane", "artisanal", "artistic",
  "assembled", "atomic", "automated", "auxiliary", "balanced", "binary", "bipolar", "bitrate", "blunt", "boolean",
  "braided", "bright", "brittle", "buffered", "calibrated", "capacitive", "cast", "cellular", "ceramic", "chiseled",
  "circular", "classic", "clear", "climatic", "clutched", "coaxial", "coherent", "collimated", "communal", "compact",
  "compiled", "complex", "composite", "concave", "conceptual", "conductive", "configurable", "configured", "constant", "convex",
  "corrosive", "creative", "crimped", "critical", "cryogenic", "crystalline", "cyberanalog", "cybercast", "cybercomplex", "cyberdigital",
  "cyberductile", "cyberdynamic", "cyberencoded", "cyberetched", "cyberforged", "cyberkinetic", "cybermilled", "cybermodern", "cybermodular", "cybernetic",
  "cybernovel", "cyberprecise", "cyberprinted", "cyberradical", "cyberrobotic", "cyberrobust", "cybershared", "cybersleek", "cyberspatial", "cybertactile",
  "cybertensile", "cybervibrant", "cyberwelded", "cyclic", "damped", "decentered", "decimal", "deformable", "dense", "diffractive",
  "diffuse", "digital", "dilatory", "diligent", "dimensional", "direct", "discrete", "disruptive", "distal", "dual",
  "ductile", "durable", "dynamic", "earthen", "educational", "efficient", "elastic", "electric", "electronic", "elliptic",
  "embedded", "emergent", "empirical", "empty", "encoded", "energetic", "equilateral", "equipped", "ergonomic", "etched",
  "evolving", "exact", "exotic", "experimental", "external", "extruded", "fabricated", "factorial", "faulty", "ferrite",
  "ferrous", "fibered", "fibrous", "filamentous", "filmic", "finite", "flanged", "flat", "flexible", "fluid",
  "fluidic", "fluorescent", "fluxed", "focal", "focused", "forged", "fractal", "fragile", "frictionless", "frontal",
  "functional", "fused", "futuristic", "galvanic", "generic", "geodesic", "geometric", "global", "glossy", "grainy",
  "granular", "graphic", "gravity", "greased", "greasy", "gritty", "guided", "hard", "hardened", "headless",
  "heated", "helical", "helpful", "hexagonal", "hollow", "hybrid", "hydraulic", "hyperanalog", "hypercast", "hypercomplex",
  "hyperdigital", "hyperductile", "hyperdynamic", "hyperencoded", "hyperetched", "hyperforged", "hyperkinetic", "hypermilled", "hypermodern", "hypermodular",
  "hypernovel", "hyperprecise", "hyperprinted", "hyperradical", "hyperrobotic", "hyperrobust", "hypershared", "hypersleek", "hyperspatial", "hypertactile",
  "hypertensile", "hypervibrant", "hyperwelded", "idling", "imaginative", "immersed", "impact", "impulse", "incandescent", "inclusive",
  "inductive", "industrial", "inert", "infinite", "infrared", "infrasonic", "ingenious", "inner", "inorganic", "insulated",
  "integral", "integrated", "intense", "internal", "intricate", "inventive", "inverse", "ionic", "isolated", "isotropic",
  "iterative", "joint", "jointed", "kiln", "kinematic", "kinetic", "knitted", "labeled", "laminar", "laminated",
  "lateral", "layered", "lead", "level", "linear", "linked", "liquid", "load", "local", "logical",
  "loose", "lubricated", "luminous", "machined", "magnetic", "main", "malleable", "manual", "massive", "matrix",
  "maximal", "measured", "mechanical", "median", "melting", "metallic", "metric", "micro", "microanalog", "microcast",
  "microcomplex", "microdigital", "microductile", "microdynamic", "microencoded", "microetched", "microforged", "microkinetic", "micromilled", "micromodern",
  "micromodular", "micronovel", "microprecise", "microprinted", "microradical", "microrobotic", "microrobust", "microshared", "microsleek", "microspatial",
  "microtactile", "microtensile", "microvibrant", "microwelded", "milled", "mineral", "minimal", "minimalist", "mobile", "modern",
  "modular", "molded", "molecular", "molten", "momentary", "monolithic", "moving", "multianalog", "multicast", "multicomplex",
  "multidigital", "multiductile", "multidynamic", "multiencoded", "multietched", "multiforged", "multikinetic", "multimilled", "multimodern", "multimodular",
  "multinovel", "multiprecise", "multiprinted", "multiradical", "multirobotic", "multirobust", "multishared", "multisleek", "multispatial", "multitactile",
  "multitensile", "multivibrant", "multiwelded", "natural", "neutral", "nominal", "normal", "notched", "novel", "nuclear",
  "nan", "numeric", "oblique", "offset", "ohmic", "opaque", "open", "operable", "optical", "optimal",
  "optimized", "orbital", "ordered", "organic", "organized", "original", "outer", "output", "parallel", "partial",
  "passive", "patterned", "peak", "pendant", "periodic", "peripheral", "pioneering", "pivotal", "planar", "planed",
  "plastic", "plated", "pliant", "pneumatic", "polar", "polished", "poly", "polymeric", "porous", "portable",
  "potted", "power", "powered", "precise", "primal", "primary", "prime", "primitive", "printed", "pristine",
  "procedural", "productive", "profiled", "program", "programmed", "progressive", "prompt", "proportional", "prototypical", "pulse",
  "pure", "quantized", "radial", "radiant", "radical", "random", "rapid", "raw", "reactive", "ready",
  "real", "reared", "recycled", "redundant", "refracted", "refractive", "regular", "relative", "relativistic", "remote",
  "residual", "resilient", "resistive", "resonant", "resourceful", "rigid", "robotic", "robust", "rotary", "rough",
  "rugged", "safe", "salient", "sanded", "saturated", "scalable", "scalar", "scaled", "schematic", "scored",
  "sealed", "secondary", "sectional", "secure", "segmental", "seismic", "selective", "serial", "series", "set",
  "shared", "sharp", "sheet", "shielded", "shifted", "short", "signal", "silent", "simple", "single",
  "singular", "slanted", "sleek", "slight", "slim", "slow", "small", "smooth", "social", "soft",
  "soldered", "solid", "solitary", "sonic", "sorted", "spatial", "special", "spectral", "speedy", "spherical",
  "spiral", "splined", "spooled", "stable", "staged", "stained", "standard", "standardized", "static", "statical",
  "stationary", "steady", "steel", "stepped", "stiff", "stoic", "stored", "straight", "strained", "stray",
  "streamlined", "stressed", "strong", "structural", "sturdy", "subtle", "sudden", "super", "supple", "surface",
  "surplus", "swivel", "symbolic", "sync", "synergetic", "synthesized", "synthetic", "systemic", "tactile", "tangent",
  "tapered", "target", "technical", "tensile", "terminal", "tested", "textured", "thermal", "thermoformed", "thick",
  "thin", "threaded", "tight", "timed", "toggle", "total", "tough", "trace", "tracked", "traction",
  "triple", "tubular", "tuned", "turbo", "turbulent", "twin", "ultraanalog", "ultracast", "ultracomplex", "ultradigital",
  "ultraductile", "ultradynamic", "ultraencoded", "ultraetched", "ultraforged", "ultrakinetic", "ultramilled", "ultramodern", "ultramodular", "ultranovel",
  "ultraprecise", "ultraprinted", "ultraradical", "ultrarobotic", "ultrarobust", "ultrashared", "ultrasleek", "ultrasonic", "ultraspatial", "ultratactile",
  "ultratensile", "ultravibrant", "ultrawelded", "unbiased", "uniform", "unique", "unit", "universal", "unused", "urban",
  "useful", "valid", "valved", "variable", "vast", "vector", "vented", "verbal", "versatile", "vertical",
  "vessel", "vibrant", "virtual", "viscous", "visible", "visionary", "visual", "vital", "vitreous", "vivid",
  "vocal", "void", "volatile", "volumetric", "vortex", "warm", "warped", "water", "watt", "weak",
  "weathered", "weighted", "welded", "wet", "wide", "wired", "wooden", "worked", "working", "woven",
  "yield", "zero", "zinc", "zone",
] as const;

export const TAB_SLUG_NOUNS = [
  "access", "acetal", "acrylic", "actuator", "adapter", "aisle", "aluminum", "anchor", "annealer", "anvil",
  "aperture", "armature", "array", "assembler", "backplane", "backup", "badge", "balljoint", "barometer", "battery",
  "bay", "beam", "bearing", "belt", "bender", "bezel", "bin", "bit", "blade", "block",
  "blower", "board", "bobbin", "boiler", "bolt", "bond", "bore", "boss", "brace", "bracket",
  "braid", "brake", "brass", "bridge", "brush", "buckle", "buffer", "build", "bunker", "burn",
  "burr", "bus", "bushing", "button", "cabinet", "cable", "caliper", "calipers", "cam", "camera",
  "canvas", "capacitor", "carbide", "carbon", "carriage", "case", "caster", "catch", "cell", "ceramic",
  "chain", "chassis", "chiller", "chip", "chisel", "circuit", "clamp", "class", "clip", "clock",
  "cloud", "clutch", "cnc", "code", "coil", "collar", "collet", "column", "community", "concept",
  "conduit", "cone", "connector", "console", "contact", "control", "cooler", "copper", "core", "cotter",
  "counter", "coupler", "coupling", "cover", "craft", "crank", "crate", "crimp", "crystal", "cup",
  "current", "curtain", "cutter", "cylinder", "damper", "dash", "data", "database", "deck", "design",
  "detent", "dial", "die", "diffuser", "digit", "diode", "disk", "display", "door", "dowel",
  "draft", "drain", "drawer", "drift", "drill", "drive", "driver", "drum", "duct", "easel",
  "edge", "elbow", "element", "encoder", "endmill", "energy", "engine", "epoxy", "event", "exhaust",
  "extruder", "fabric", "fan", "fastener", "feed", "felt", "fence", "fiber", "filament", "file",
  "filler", "filter", "fin", "fixture", "flange", "flash", "float", "floor", "flow", "fluid",
  "flux", "focal", "focus", "foot", "force", "forge", "form", "frame", "friction", "frit",
  "fuel", "fuse", "gage", "gap", "gasket", "gate", "gauge", "gear", "gearbox", "generator",
  "gimbal", "gland", "glass", "glaze", "glue", "goal", "grade", "grain", "grease", "grid",
  "grinder", "grip", "grommet", "groove", "ground", "guard", "guide", "guild", "hack", "hammer",
  "handle", "hatch", "head", "header", "heat", "heater", "height", "helix", "hide", "hinge",
  "hoist", "holder", "hook", "hose", "housing", "hub", "humidity", "id", "idea", "impeller",
  "index", "indicator", "inkjet", "inlet", "input", "insert", "intake", "interface", "inverter", "iron",
  "jack", "jacket", "jaw", "jet", "jig", "joint", "jointer", "journal", "jumper", "kerf",
  "kernel", "key", "keyway", "kiln", "knob", "lab", "label", "lamp", "laser",
  "latch", "latex", "lathe", "layer", "layout", "lead", "leaf", "leather", "led", "leg",
  "lens", "level", "lever", "lift", "light", "limit", "line", "link", "load", "lock",
  "locker", "logic", "loom", "loop", "lube", "lug", "magnet", "make", "manifold", "marker",
  "mask", "mass", "match", "matrix", "matte", "measure", "meeting", "member", "mentor", "mesh",
  "metal", "meter", "micro", "micron", "mill", "mirror", "model", "module", "mold", "monitor",
  "mosfet", "motion", "motor", "mount", "multimeter", "needle", "net", "network", "node", "notch",
  "nozzle", "nut", "nylon", "object", "offset", "ohm", "oil", "optics", "orbit", "oscilloscope",
  "outlet", "output", "overlay", "pack", "packet", "pad", "paint", "pallet", "panel", "parallel",
  "part", "patch", "path", "pattern", "peg", "pellet", "pendant", "phase", "phone", "pigment",
  "pin", "pipe", "piston", "pit", "pitch", "pivot", "pixel", "plan", "plane", "planer",
  "plasma", "plaster", "plastic", "plate", "platform", "pliers", "plot", "plug", "ply", "plywood",
  "point", "pole", "policy", "polymer", "port", "post", "power", "press", "printer", "probe",
  "process", "profile", "project", "prong", "prop", "protocol", "prototype", "proxy", "pull", "pulley",
  "pulse", "pump", "punch", "purge", "push", "quad", "quilt", "rack", "radial", "rail",
  "ram", "range", "raster", "rate", "ratio", "ray", "reach", "reamer", "rear", "receiver",
  "record", "reel", "reflector", "regulator", "relay", "release", "relief", "remote", "render", "reset",
  "residual", "resin", "resistor", "result", "return", "rib", "ring", "rivet", "rod", "roll",
  "roller", "root", "rope", "rotor", "rough", "round", "route", "router", "row", "rule",
  "run", "saddle", "safety", "sample", "sand", "sandpaper", "saw", "scale", "scanner", "scheme",
  "scope", "score", "scrap", "screen", "screw", "script", "seal", "seam", "seat", "sector",
  "seed", "segment", "sensor", "sequence", "serger", "series", "server", "servo", "set", "setup",
  "shackle", "shade", "shaft", "shank", "shape", "shave", "shear", "sheath", "sheet", "shelf",
  "shell", "shield", "shift", "shim", "ship", "shock", "shoe", "shredder", "shunt", "shutter",
  "side", "sieve", "signal", "silica", "silicone", "sine", "sink", "site", "size", "skate",
  "sketch", "skid", "skill", "skin", "skirt", "slab", "slag", "sleeve", "slice", "slide",
  "sling", "slip", "sliver", "slot", "slug", "slump", "snap", "snip", "socket", "solder",
  "source", "space", "spacer", "span", "spark", "speed", "sphere", "spindle", "splice", "spline",
  "split", "spool", "spot", "spray", "spring", "sprocket", "spur", "square", "stack", "stage",
  "stall", "stamp", "stand", "start", "state", "station", "stator", "status", "stay", "steam",
  "steel", "steer", "stem", "step", "stick", "stitching", "stock", "stone", "stop", "store",
  "strain", "strap", "stream", "stress", "string", "strip", "strobe", "stroke", "strut", "stud",
  "studio", "stuff", "style", "sub", "sum", "supply", "support", "surface", "surge", "swage",
  "switch", "swivel", "symbol", "sync", "system", "tab", "table", "tack", "tag", "tail",
  "tank", "tape", "taper", "target", "task", "team", "tech", "template", "tension", "term",
  "terminal", "test", "text", "thermometer", "thread", "thrust", "thumb", "tie", "tile", "timber",
  "time", "timer", "timing", "tip", "tire", "toggle", "token", "tongs", "tool", "tooth",
  "top", "torch", "torque", "tour", "trace", "traces", "track", "trade", "trail", "train",
  "tray", "tread", "trigger", "trim", "trip", "tripod", "trough", "truck", "tube", "tubing",
  "tuner", "tunnel", "turn", "twin", "twist", "type", "unit", "upload", "vacuum", "valve",
  "vane", "vapor", "vat", "vector", "veneer", "vent", "vessel", "video", "view", "vinyl",
  "vise", "vision", "voice", "voltage", "volume", "vortex", "waiver", "wall", "wash", "washer",
  "waste", "water", "wave", "wax", "way", "wear", "weave", "web", "wedge", "weight",
  "weld", "welder", "wheel", "wick", "width", "winch", "wind", "window", "wing", "wire",
  "wood", "work", "workflow", "workshop", "wrap", "wrench", "wrist", "yoke", "zero", "zinc",
  "zone",
] as const;

type RandomBytes = (length: number) => Uint8Array;

type TabSlugOptions = {
  randomBytes?: RandomBytes;
};

const MAX_GENERATION_ATTEMPTS = 1000;

function cryptoRandomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function randomIndex(maxExclusive: number, randomBytes: RandomBytes) {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error("Unable to choose from an empty tab slug word list");
  }

  const bytesNeeded = Math.ceil(Math.log2(maxExclusive) / 8);
  const sampleSpace = 256 ** bytesNeeded;
  const maxUnbiasedValue = Math.floor(sampleSpace / maxExclusive) * maxExclusive;

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    let value = 0;
    for (const byte of randomBytes(bytesNeeded)) {
      value = (value * 256) + byte;
    }
    if (value < maxUnbiasedValue) return value % maxExclusive;
  }

  throw new Error("Unable to choose a tab slug word");
}

export function makeTabSlug(options: TabSlugOptions = {}) {
  const randomBytes = options.randomBytes ?? cryptoRandomBytes;
  const adjective = TAB_SLUG_ADJECTIVES[randomIndex(TAB_SLUG_ADJECTIVES.length, randomBytes)];
  const noun = TAB_SLUG_NOUNS[randomIndex(TAB_SLUG_NOUNS.length, randomBytes)];
  const tail = randomShortIdSuffix({ length: TAB_SLUG_TAIL_LENGTH, randomBytes });
  return `${adjective}-${noun}-${tail}`;
}

export function makeTabSlugId(existingIds: Iterable<string> = [], options: TabSlugOptions = {}) {
  const existing = new Set(existingIds);

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const id = makeTabSlug(options);
    if (!existing.has(id)) return id;
  }

  throw new Error("Unable to generate a unique tab slug");
}

export function isTabSlugTail(value: string) {
  return value.length === TAB_SLUG_TAIL_LENGTH
    && [...value].every((char) => SHORT_ID_ALPHABET.includes(char));
}
