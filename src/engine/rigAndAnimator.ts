import {
  compileMouthGeometry,
  deformVertexByCustomMouth,
} from './mouthPenGeometry';
import {
  AnimationSettings,
  EvaluatedPose,
  KeyframePoint,
  PresetAnimationId,
  PresetDefinition,
  PuppetMesh,
  PuppetRig,
  RecordedSample,
  Vec2,
  VisemeShape,
} from './types';

export const PRESET_ANIMATIONS: PresetDefinition[] = [
  {
    id: 'talk_natural',
    nameFa: 'حرف زدن طبیعی',
    subtitleFa: 'دیالوگ روزمره + حرکت نرم سر و دست',
    category: 'talking',
    defaultDuration: 2.6,
    involvesTalking: true,
    badgeColor: '#818cf8',
  },
  {
    id: 'talk_excited',
    nameFa: 'حرف زدن پرانرژی',
    subtitleFa: 'سخنرانی هیجانی با ژست دست‌ها',
    category: 'talking',
    defaultDuration: 2.4,
    involvesTalking: true,
    badgeColor: '#c084fc',
  },
  {
    id: 'laugh',
    nameFa: 'خندیدن و قهقهه',
    subtitleFa: 'لرزش شاد شانه‌ها و خنده ریتمیک',
    category: 'talking',
    defaultDuration: 2.0,
    involvesTalking: true,
    badgeColor: '#f472b6',
  },
  {
    id: 'wave_hello',
    nameFa: 'سلام و دست تکان دادن',
    subtitleFa: 'بالا بردن دست و احوال‌پرسی گرم',
    category: 'action',
    defaultDuration: 2.2,
    involvesTalking: true,
    badgeColor: '#38bdf8',
  },
  {
    id: 'happy_jump',
    nameFa: 'پرش شادی و هورا',
    subtitleFa: 'خیز، پرش با دست‌های باز و فرود نرم',
    category: 'action',
    defaultDuration: 1.8,
    involvesTalking: false,
    badgeColor: '#34d399',
  },
  {
    id: 'dance_groove',
    nameFa: 'رقص شاد و ریتمیک',
    subtitleFa: 'حرکت موزون کمر، دست‌ها و سر',
    category: 'action',
    defaultDuration: 2.0,
    involvesTalking: false,
    badgeColor: '#fb923c',
  },
  {
    id: 'walk_cycle',
    nameFa: 'راه رفتن',
    subtitleFa: 'چرخه کامل قدم زدن دو بعدی',
    category: 'action',
    defaultDuration: 1.6,
    involvesTalking: false,
    badgeColor: '#2dd4bf',
  },
  {
    id: 'run_cycle',
    nameFa: 'دویدن سریع',
    subtitleFa: 'حرکت تند پاها با خم شدن به جلو',
    category: 'action',
    defaultDuration: 1.1,
    involvesTalking: false,
    badgeColor: '#facc15',
  },
  {
    id: 'idle_breathe',
    nameFa: 'نفس کشیدن (زنده)',
    subtitleFa: 'حالت انتظار طبیعی و زنده شدن عکس',
    category: 'reaction',
    defaultDuration: 2.8,
    involvesTalking: false,
    badgeColor: '#60a5fa',
  },
  {
    id: 'surprised',
    nameFa: 'تعجب و شوکه شدن',
    subtitleFa: 'عقب رفتن ناگهانی و باز ماندن دهان',
    category: 'reaction',
    defaultDuration: 2.0,
    involvesTalking: true,
    badgeColor: '#fb7185',
  },
  {
    id: 'nod_yes',
    nameFa: 'تایید (بله گفتن)',
    subtitleFa: 'تکان دادن سر به نشانه موافقت',
    category: 'reaction',
    defaultDuration: 1.8,
    involvesTalking: false,
    badgeColor: '#4ade80',
  },
  {
    id: 'shake_no',
    nameFa: 'مخالفت (نه گفتن)',
    subtitleFa: 'تکان دادن سر و دست به نشانه نه',
    category: 'reaction',
    defaultDuration: 1.8,
    involvesTalking: false,
    badgeColor: '#f87171',
  },
];

const TAU = Math.PI * 2;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Generates a periodic, loop-safe (u=0 and u=1 closed!) syllable & viseme curve
 * either from user dialogue text (Persian/English) or natural procedural speech.
 */
export function evaluateSpeechSignal(
  u: number,
  dialogueText: string,
  presetId: PresetAnimationId,
  intensity: number
): { open: number; wide: number; viseme: VisemeShape } {
  const cleanText = dialogueText.trim();

  if (presetId === 'laugh') {
    // Ha-ha-ha-ha rhythmic laugh envelope (loop-seamless!)
    const env = 0.55 + 0.45 * Math.sin(TAU * u - Math.PI * 0.3);
    const pulse = Math.pow(Math.max(0, Math.sin(TAU * 5 * u)), 0.75);
    const open = clamp(pulse * env * 1.05 * intensity, 0, 1.45);
    return {
      open,
      wide: 0.28 * clamp(intensity, 0.4, 1.5),
      viseme: open > 0.35 ? 'A' : 'smile',
    };
  }

  if (presetId === 'surprised') {
    // Gasps open cleanly in middle of loop, closes smoothly at start/end
    const gasp =
      smoothstep(0.14, 0.26, u) * (1 - smoothstep(0.74, 0.9, u));
    const tremor = 1 + 0.08 * Math.sin(TAU * 8 * u);
    const open = clamp(gasp * tremor * 1.15 * intensity, 0, 1.5);
    return {
      open,
      wide: -0.22 * gasp,
      viseme: open > 0.4 ? 'O' : 'rest',
    };
  }

  if (cleanText.length > 0) {
    // Parse Persian & Latin characters into timed phonetic syllables inside [0.05..0.92]
    const tokens: Array<{ viseme: VisemeShape; amp: number; wide: number }> = [];
    for (let i = 0; i < cleanText.length; i++) {
      const ch = cleanText[i];
      if (ch === ' ' || ch === '‌') {
        tokens.push({ viseme: 'rest', amp: 0.05, wide: 0 });
      } else if (/[.!؟?,،؛:]/.test(ch)) {
        tokens.push({ viseme: 'rest', amp: 0, wide: 0 });
      } else if (/[آاaA]/.test(ch)) {
        tokens.push({ viseme: 'A', amp: 0.95, wide: 0.12 });
      } else if (/[وuUoO]/.test(ch)) {
        tokens.push({ viseme: 'O', amp: 0.78, wide: -0.25 });
      } else if (/[یeEiI]/.test(ch)) {
        tokens.push({ viseme: 'E', amp: 0.65, wide: 0.3 });
      } else if (/[مبپmMbBpP]/.test(ch)) {
        tokens.push({ viseme: 'M', amp: 0.06, wide: 0.06 });
        tokens.push({ viseme: 'A', amp: 0.68, wide: 0.08 });
      } else {
        // Consonant with implied short Persian vowel (a/e/o)
        const vCycle: VisemeShape[] = ['A', 'E', 'O'];
        const chosen = vCycle[i % 3];
        tokens.push({
          viseme: chosen,
          amp: chosen === 'A' ? 0.76 : 0.6,
          wide: chosen === 'O' ? -0.16 : 0.15,
        });
      }
    }

    // Cap token count for crisp syllable pacing
    const maxSil = 24;
    const step = Math.max(1, Math.ceil(tokens.length / maxSil));
    const compact = tokens.filter((_, idx) => idx % step === 0);

    const startU = 0.05;
    const endU = 0.92;
    if (u <= startU || u >= endU || compact.length === 0) {
      return { open: 0, wide: 0.05, viseme: 'rest' };
    }

    const phraseFade =
      smoothstep(startU, startU + 0.04, u) *
      (1 - smoothstep(endU - 0.05, endU, u));
    const localPos = ((u - startU) / (endU - startU)) * compact.length;
    const idx = clamp(Math.floor(localPos), 0, compact.length - 1);
    const frac = localPos - idx;
    const prevTok = compact[Math.max(0, idx - 1)];
    const cur = compact[idx];
    const nextTok = compact[Math.min(compact.length - 1, idx + 1)];

    // Smooth co-articulation across syllable boundaries (no abrupt jumps!)
    const sylBell = 0.5 - 0.5 * Math.cos(frac * TAU);
    const bridgeAmp =
      frac < 0.5
        ? Math.min(prevTok.amp, cur.amp) * 0.22
        : Math.min(cur.amp, nextTok.amp) * 0.22;
    const blendedWide =
      frac < 0.5
        ? prevTok.wide * (0.5 - frac) + cur.wide * (0.5 + frac)
        : cur.wide * (1.5 - frac) + nextTok.wide * (frac - 0.5);

    const open = clamp(
      (bridgeAmp * (1 - sylBell) + cur.amp * sylBell) * phraseFade * intensity,
      0,
      1.35
    );
    return {
      open,
      wide: blendedWide * phraseFade,
      viseme: open < 0.1 ? 'M' : cur.viseme,
    };
  }

  // Procedural multi-harmonic natural speech cadence (100% periodic at u=0 and u=1!)
  const edgeGate =
    smoothstep(0.0, 0.06, u) * (1 - smoothstep(0.93, 1.0, u));
  // Pause in the middle like taking a natural breath between two short clauses
  const clausePause = 1 - 0.82 * Math.exp(-Math.pow((u - 0.52) / 0.055, 2));

  const s1 = Math.pow(Math.max(0, Math.sin(TAU * 4 * u)), 1.15);
  const s2 = Math.pow(Math.max(0, Math.sin(TAU * 7 * u + 0.8)), 1.15);
  const s3 = Math.pow(Math.max(0, Math.sin(TAU * 11 * u + 1.9)), 1.2);
  const rawOpen = (0.44 * s1 + 0.34 * s2 + 0.24 * s3) * clausePause * edgeGate;
  const excitedBoost = presetId === 'talk_excited' ? 1.18 : 1.0;
  const open = clamp(rawOpen * excitedBoost * intensity, 0, 1.35);

  const wideWave = Math.sin(TAU * 3 * u + 0.5) * 0.22 * edgeGate;
  let viseme: VisemeShape = 'rest';
  if (open > 0.62) {
    viseme = wideWave < -0.06 ? 'O' : 'A';
  } else if (open > 0.25) {
    viseme = wideWave > 0.05 ? 'E' : 'U';
  } else if (open > 0.06) {
    viseme = 'M';
  } else {
    viseme = 'smile';
  }

  return { open, wide: wideWave, viseme };
}

interface LocalJointMotion {
  dx: number;
  dy: number;
  rot: number;
  sx: number;
  sy: number;
}

/**
 * Evaluates the full hierarchical 2D puppet pose at normalized loop time u in [0, 1).
 */
export function evaluatePuppetPose(
  rig: PuppetRig,
  settings: AnimationSettings,
  normTimeInput: number,
  keyframes: KeyframePoint[] = [],
  recordedSamples: RecordedSample[] = [],
  liveJointOffsets: Record<string, Vec2> = {},
  liveMouthOverride: number | null = null
): EvaluatedPose {
  // Wrap u cleanly into [0, 1)
  let u = normTimeInput % 1;
  if (u < 0) u += 1;

  // Calibrated default gain so 100% bodyIntensity stays crisp, controlled & natural
  const bodyAmp = settings.bodyIntensity * 0.78;
  const spring = settings.springiness;
  const p = settings.presetId;

  const local: Record<string, LocalJointMotion> = {};
  for (const j of rig.joints) {
    local[j.id] = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 };
  }

  const addMotion = (
    id: string,
    dx: number,
    dy: number,
    rot = 0,
    sx = 1,
    sy = 1
  ) => {
    if (!local[id]) return;
    local[id].dx += dx * bodyAmp;
    local[id].dy += dy * bodyAmp;
    local[id].rot += rot * bodyAmp;
    local[id].sx *= 1 + (sx - 1) * spring * bodyAmp;
    local[id].sy *= 1 + (sy - 1) * spring * bodyAmp;
  };

  let groundLift = 0;
  let browLift = 0;

  const c1 = Math.cos(TAU * u);
  const s1 = Math.sin(TAU * u);
  const c2 = Math.cos(TAU * 2 * u);
  const s2 = Math.sin(TAU * 2 * u);
  const s3 = Math.sin(TAU * 3 * u);
  const s4 = Math.sin(TAU * 4 * u);

  switch (p) {
    case 'talk_natural': {
      // Gentle breathing + expressive subtle head tilts + natural conversational hand gestures
      addMotion('hips', 0.004 * s1, 0.004 * c2, 0.015 * s1, 1, 1 - 0.012 * c2);
      addMotion('chest', 0, -0.006 * s2, 0.025 * s1, 1 + 0.015 * s2, 1 - 0.01 * s2);
      addMotion('head', 0.005 * s2, -0.004 * c2, 0.065 * s1 + 0.035 * s3);
      addMotion('l_hand', -0.018 * (0.5 - 0.5 * c2), -0.028 * Math.max(0, s1), -0.08 * s1);
      addMotion('r_hand', 0.022 * (0.5 - 0.5 * c1), -0.036 * Math.max(0, -s1 + 0.3 * s2), 0.1 * s2);
      addMotion('l_shoulder', 0, -0.005 * s2, 0);
      addMotion('r_shoulder', 0, -0.005 * s2, 0);
      browLift = 0.35 * s2 + 0.25 * s3;
      break;
    }

    case 'talk_excited': {
      // Energetic bounce, enthusiastic two-hand gestures, lively head nods
      const bounce = Math.abs(s2);
      addMotion('hips', 0.008 * s1, -0.014 * bounce, 0.03 * s1, 1 + 0.025 * (1 - bounce), 1 - 0.025 * (1 - bounce));
      addMotion('chest', 0, -0.01 * s2, 0.05 * s1, 1 + 0.02 * s2, 1);
      addMotion('head', 0.008 * s2, -0.008 * bounce, 0.11 * s1 + 0.06 * s3, 1, 1 + 0.02 * bounce);
      addMotion('l_hand', -0.035 * (0.5 + 0.5 * s2), -0.075 * (0.5 + 0.5 * s1), -0.18 * s2);
      addMotion('r_hand', 0.038 * (0.5 + 0.5 * c2), -0.082 * (0.5 - 0.5 * s1), 0.18 * c2);
      addMotion('l_shoulder', 0, -0.012 * bounce, 0);
      addMotion('r_shoulder', 0, -0.012 * bounce, 0);
      groundLift = 0.012 * bounce * bodyAmp;
      browLift = 0.65 * bounce;
      break;
    }

    case 'laugh': {
      // Rapid belly & shoulder laugh shake + head tilted slightly back
      const shake = Math.sin(TAU * 5 * u);
      const env = 0.6 + 0.4 * s1;
      addMotion('hips', 0, 0.008 * shake * env, 0.02 * s1, 1 + 0.03 * shake * env, 1 - 0.025 * shake * env);
      addMotion('chest', 0, -0.016 * shake * env, -0.03 * s1, 1 + 0.035 * env, 1 - 0.02 * shake);
      addMotion('head', 0, -0.012 * env + 0.008 * shake, -0.08 * env + 0.045 * s2);
      addMotion('l_shoulder', 0, -0.022 * shake * env, 0);
      addMotion('r_shoulder', 0, -0.022 * shake * env, 0);
      addMotion('l_hand', 0.025 * env, -0.035 * env + 0.015 * shake, 0);
      addMotion('r_hand', -0.025 * env, -0.035 * env + 0.015 * shake, 0);
      browLift = 0.5 * env;
      break;
    }

    case 'wave_hello': {
      // Raise right hand (viewer's right) high and wave back & forth smoothly
      const raiseEnv =
        smoothstep(0.0, 0.16, u) * (1 - smoothstep(0.84, 1.0, u));
      const waveSwing = Math.sin(TAU * 3 * u) * raiseEnv;
      addMotion('hips', -0.008 * raiseEnv, 0.004 * c2, -0.02 * raiseEnv);
      addMotion('chest', 0, -0.006 * s2, -0.035 * raiseEnv + 0.02 * waveSwing);
      addMotion('head', 0.006 * waveSwing, 0, 0.08 * raiseEnv + 0.045 * waveSwing);
      addMotion('r_shoulder', -0.008 * raiseEnv, -0.018 * raiseEnv, 0);
      addMotion(
        'r_hand',
        -0.015 * raiseEnv + 0.052 * waveSwing,
        -0.145 * raiseEnv - 0.015 * Math.abs(waveSwing),
        0.25 * waveSwing
      );
      addMotion('l_hand', -0.01 * s1, 0.012 * raiseEnv, 0);
      browLift = 0.45 * raiseEnv;
      break;
    }

    case 'happy_jump': {
      // Anticipation crouch -> High joyful leap -> Soft landing squash (100% periodic!)
      // Phase: crouch around u=0.15, peak jump at u=0.50, land squash at u=0.82
      const jumpArc = Math.max(0, Math.sin(Math.PI * clamp((u - 0.22) / 0.54, 0, 1)));
      const crouch1 = Math.exp(-Math.pow((u - 0.15) / 0.075, 2));
      const crouch2 = Math.exp(-Math.pow((u - 0.83) / 0.075, 2));
      const squash = crouch1 + 0.85 * crouch2;

      const dyJump = -0.115 * jumpArc + 0.034 * squash;
      const sx = 1 + 0.09 * squash - 0.06 * jumpArc;
      const sy = 1 - 0.09 * squash + 0.07 * jumpArc;

      addMotion('hips', 0, dyJump, 0, sx, sy);
      addMotion('chest', 0, -0.012 * jumpArc, 0.03 * s2, sx, sy);
      addMotion('head', 0, -0.01 * jumpArc + 0.008 * squash, 0.05 * s2);
      addMotion('l_hand', -0.045 * jumpArc, -0.13 * jumpArc + 0.03 * squash, -0.2 * jumpArc);
      addMotion('r_hand', 0.045 * jumpArc, -0.13 * jumpArc + 0.03 * squash, 0.2 * jumpArc);
      // Feet tuck/point during jump, stay planted during crouch
      addMotion('l_foot', -0.02 * jumpArc, -0.085 * jumpArc, 0);
      addMotion('r_foot', 0.02 * jumpArc, -0.085 * jumpArc, 0);
      groundLift = Math.max(0, jumpArc * 0.12 * bodyAmp);
      browLift = 0.7 * jumpArc;
      break;
    }

    case 'dance_groove': {
      // Rhythmic left-right hip sway, knee bounce, alternating funky arm pumps!
      const beat = Math.abs(s2);
      addMotion('hips', 0.042 * s1, 0.024 * beat, -0.08 * s1, 1 + 0.04 * beat, 1 - 0.035 * beat);
      addMotion('chest', -0.018 * s1, -0.01 * beat, 0.09 * s1);
      addMotion('head', 0.012 * s2, 0.01 * beat, -0.11 * s1 + 0.05 * s2);
      addMotion('l_hand', -0.03 * c1, -0.095 * (0.5 + 0.5 * s1), -0.2 * s1);
      addMotion('r_hand', 0.03 * c1, -0.095 * (0.5 - 0.5 * s1), 0.2 * s1);
      addMotion('l_foot', -0.022 * Math.max(0, s1), -0.032 * Math.max(0, s1), 0);
      addMotion('r_foot', 0.022 * Math.max(0, -s1), -0.032 * Math.max(0, -s1), 0);
      browLift = 0.4 * beat;
      break;
    }

    case 'walk_cycle': {
      // Classic 2D Walk Cycle: opposite arm/leg swing + double-frequency hip bob
      const strideX = 0.058;
      const liftY = 0.042;
      addMotion('hips', 0.008 * s1, -0.016 * Math.abs(c1) + 0.008, 0.025 * s1);
      addMotion('chest', 0.006 * s1, -0.006 * c2, 0.035 * s1);
      addMotion('head', 0, -0.005 * c2, -0.03 * s1 + 0.02 * c2);

      // Left & Right feet stride with foot-lift on forward swing
      addMotion('l_foot', strideX * s1, -liftY * Math.max(0, c1), 0);
      addMotion('r_foot', -strideX * s1, -liftY * Math.max(0, -c1), 0);

      // Counter-swinging arms
      addMotion('l_hand', -0.048 * s1, 0.015 * Math.abs(s1) - 0.01, 0.12 * s1);
      addMotion('r_hand', 0.048 * s1, 0.015 * Math.abs(s1) - 0.01, -0.12 * s1);
      break;
    }

    case 'run_cycle': {
      // Energetic fast run cycle with aerial bounce & forward lean
      const strideX = 0.092;
      const liftY = 0.068;
      const flight = Math.max(0, -c2);
      addMotion('hips', 0.012, -0.028 * flight + 0.01, 0.08 + 0.03 * s1, 1 - 0.02 * flight, 1 + 0.02 * flight);
      addMotion('chest', 0.016, -0.008 * c2, 0.09 + 0.04 * s1);
      addMotion('head', 0.008, -0.006 * c2, -0.04 + 0.04 * c2);

      addMotion('l_foot', strideX * s1, -liftY * Math.max(0, c1), 0);
      addMotion('r_foot', -strideX * s1, -liftY * Math.max(0, -c1), 0);

      addMotion('l_hand', -0.072 * s1, -0.035 - 0.02 * c1, 0.2 * s1);
      addMotion('r_hand', 0.072 * s1, -0.035 + 0.02 * c1, -0.2 * s1);
      groundLift = 0.025 * flight * bodyAmp;
      break;
    }

    case 'idle_breathe': {
      // Subtle living character breath & soft weight shift
      addMotion('hips', 0.005 * s1, 0.003 * c1, 0.012 * s1);
      addMotion('chest', 0, -0.009 * (0.5 - 0.5 * c1), 0.015 * s1, 1 + 0.022 * (0.5 - 0.5 * c1), 1 + 0.012 * (0.5 - 0.5 * c1));
      addMotion('head', 0.003 * s1, -0.004 * (0.5 - 0.5 * c1), 0.032 * Math.sin(TAU * u - 0.5));
      addMotion('l_hand', -0.008 * (0.5 - 0.5 * c1), 0.006 * c1, 0);
      addMotion('r_hand', 0.008 * (0.5 - 0.5 * c1), 0.006 * c1, 0);
      break;
    }

    case 'surprised': {
      // Quick pull-back & upward stretch shock with trembling raised hands
      const shock =
        smoothstep(0.1, 0.22, u) * (1 - smoothstep(0.76, 0.92, u));
      const tremor = Math.sin(TAU * 10 * u) * shock;
      addMotion(
        'hips',
        -0.012 * shock,
        -0.025 * shock,
        -0.03 * shock,
        1 - 0.045 * shock,
        1 + 0.055 * shock
      );
      addMotion('chest', -0.01 * shock, -0.015 * shock, -0.04 * shock);
      addMotion('head', -0.008 * shock + 0.004 * tremor, -0.018 * shock, -0.06 * shock + 0.025 * tremor);
      addMotion('l_hand', -0.025 * shock + 0.007 * tremor, -0.095 * shock, 0);
      addMotion('r_hand', 0.025 * shock - 0.007 * tremor, -0.095 * shock, 0);
      browLift = 0.95 * shock;
      groundLift = 0.02 * shock * bodyAmp;
      break;
    }

    case 'nod_yes': {
      // Enthusiastic double/triple vertical nod of agreement
      const nodEnv = smoothstep(0.05, 0.18, u) * (1 - smoothstep(0.82, 0.96, u));
      const nodWave = Math.sin(TAU * 3 * u) * nodEnv;
      addMotion('chest', 0, 0.008 * Math.max(0, nodWave), 0.025 * nodWave);
      addMotion('head', 0, 0.026 * nodWave, 0.06 * nodWave, 1 + 0.02 * nodWave, 1 - 0.02 * nodWave);
      addMotion('r_hand', 0.015 * nodEnv, -0.04 * nodEnv + 0.012 * nodWave, 0);
      browLift = 0.35 * nodEnv;
      break;
    }

    case 'shake_no': {
      // Clear horizontal head shake + defensive hand wave
      const noEnv = smoothstep(0.05, 0.18, u) * (1 - smoothstep(0.82, 0.96, u));
      const shakeWave = Math.sin(TAU * 3 * u) * noEnv;
      addMotion('chest', 0.008 * shakeWave, 0, -0.03 * shakeWave);
      addMotion('head', 0.032 * shakeWave, 0, -0.13 * shakeWave);
      addMotion('l_hand', 0.03 * shakeWave, -0.045 * noEnv, 0);
      addMotion('r_hand', 0.03 * shakeWave, -0.045 * noEnv, 0);
      break;
    }

    case 'custom_only':
    default:
      break;
  }

  // Evaluate Hierarchical Forward Kinematics (parent translation + rotation propagation)
  const worldJoints: Record<string, Vec2> = {};
  const worldRotations: Record<string, number> = {};
  const worldScales: Record<string, Vec2> = {};

  // Build map & topological visit from roots to leaves
  const jointMap = new Map(rig.joints.map((j) => [j.id, j]));
  const evaluated = new Set<string>();

  const evalJoint = (id: string) => {
    if (evaluated.has(id)) return;
    const j = jointMap.get(id);
    if (!j) return;
    evaluated.add(id);

    const loc = local[id] || { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 };

    if (!j.parentId || !jointMap.has(j.parentId)) {
      worldJoints[id] = {
        x: j.pinned ? j.rest.x : j.rest.x + loc.dx,
        y: j.pinned ? j.rest.y : j.rest.y + loc.dy,
      };
      worldRotations[id] = j.pinned ? 0 : loc.rot;
      worldScales[id] = { x: loc.sx, y: loc.sy };
      return;
    }

    evalJoint(j.parentId);
    const parent = jointMap.get(j.parentId)!;
    const pWorld = worldJoints[j.parentId];
    const pRot = worldRotations[j.parentId];
    const pScale = worldScales[j.parentId];

    const relX = (j.rest.x - parent.rest.x) * pScale.x;
    const relY = (j.rest.y - parent.rest.y) * pScale.y;
    const cosR = Math.cos(pRot);
    const sinR = Math.sin(pRot);

    const rotRelX = relX * cosR - relY * sinR;
    const rotRelY = relX * sinR + relY * cosR;

    if (j.pinned) {
      worldJoints[id] = { x: j.rest.x, y: j.rest.y };
      worldRotations[id] = 0;
      worldScales[id] = { x: 1, y: 1 };
    } else {
      worldJoints[id] = {
        x: pWorld.x + rotRelX + loc.dx,
        y: pWorld.y + rotRelY + loc.dy,
      };
      worldRotations[id] = pRot + loc.rot;
      worldScales[id] = {
        x: pScale.x * loc.sx,
        y: pScale.y * loc.sy,
      };
    }
  };

  for (const j of rig.joints) {
    evalJoint(j.id);
  }

  // Layer 1b: Ground-plant feet on standing presets + natural 2-bone elbow/knee bend!
  const STANDING_PRESETS = new Set<PresetAnimationId>([
    'idle_breathe',
    'talk_natural',
    'talk_excited',
    'wave_hello',
    'laugh',
    'nod_yes',
    'shake_no',
    'surprised',
  ]);

  if (p !== 'custom_only') {
    if (STANDING_PRESETS.has(p)) {
      for (const fId of ['l_foot', 'r_foot']) {
        const fJoint = jointMap.get(fId);
        if (fJoint && worldJoints[fId]) {
          // Keep standing feet planted cleanly on the floor!
          worldJoints[fId] = { x: fJoint.rest.x, y: fJoint.rest.y };
        }
      }
    }

    // Solve smooth 2-bone mid-joints (elbows & knees) between root and end effector
    const solveMidLimb = (
      rootId: string,
      midId: string,
      endId: string,
      outwardSign: number
    ) => {
      const rJ = jointMap.get(rootId);
      const mJ = jointMap.get(midId);
      const eJ = jointMap.get(endId);
      if (!rJ || !mJ || !eJ || mJ.pinned) return;

      const rW = worldJoints[rootId];
      const eW = worldJoints[endId];
      if (!rW || !eW) return;

      // Preserve the character's rest-pose bend offset + subtle foreshortening bend
      const restMidX = (rJ.rest.x + eJ.rest.x) * 0.5;
      const restMidY = (rJ.rest.y + eJ.rest.y) * 0.5;
      const bendOffX = mJ.rest.x - restMidX;
      const bendOffY = mJ.rest.y - restMidY;

      const restLen = Math.hypot(eJ.rest.x - rJ.rest.x, eJ.rest.y - rJ.rest.y);
      const curDx = eW.x - rW.x;
      const curDy = eW.y - rW.y;
      const curLen = Math.hypot(curDx, curDy);
      const compress =
        restLen > 1e-4 ? Math.max(0, 1 - curLen / restLen) : 0;
      const perpLen = curLen > 1e-4 ? compress * restLen * 0.28 : 0;
      const nx = curLen > 1e-4 ? (-curDy / curLen) * outwardSign : 0;
      const ny = curLen > 1e-4 ? (curDx / curLen) * outwardSign : 0;

      worldJoints[midId] = {
        x: (rW.x + eW.x) * 0.5 + bendOffX + nx * perpLen,
        y: (rW.y + eW.y) * 0.5 + bendOffY + ny * perpLen,
      };
    };

    solveMidLimb('l_shoulder', 'l_elbow', 'l_hand', -1);
    solveMidLimb('r_shoulder', 'r_elbow', 'r_hand', 1);
    solveMidLimb('hips', 'l_knee', 'l_foot', 0);
    solveMidLimb('hips', 'r_knee', 'r_foot', 0);
  }

  // Layer 2: Recorded Puppeteering Samples (smooth linear interpolation along loop)
  let recordedMouth: number | undefined;
  if (recordedSamples.length > 0) {
    const sorted = recordedSamples;
    // Find surrounding samples
    let idx = 0;
    while (idx < sorted.length - 1 && sorted[idx + 1].t <= u) {
      idx++;
    }
    const sA = sorted[idx];
    const sB = sorted[(idx + 1) % sorted.length];
    let span = sB.t - sA.t;
    if (span <= 0) span += 1;
    let rel = u - sA.t;
    if (rel < 0) rel += 1;
    const alpha = span > 1e-5 ? clamp(rel / span, 0, 1) : 0;

    for (const j of rig.joints) {
      if (j.pinned) continue;
      const offA = sA.jointOffsets[j.id];
      const offB = sB.jointOffsets[j.id];
      if (offA || offB) {
        const ax = offA?.x ?? 0,
          ay = offA?.y ?? 0;
        const bx = offB?.x ?? 0,
          by = offB?.y ?? 0;
        worldJoints[j.id].x += ax + (bx - ax) * alpha;
        worldJoints[j.id].y += ay + (by - ay) * alpha;
      }
    }
    if (sA.mouthOpen !== undefined || sB.mouthOpen !== undefined) {
      const mA = sA.mouthOpen ?? 0;
      const mB = sB.mouthOpen ?? 0;
      recordedMouth = mA + (mB - mA) * alpha;
    }
  }

  // Layer 3: Explicit User Keyframes (smoothstep Catmull/Ease interpolation across loop)
  let keyframeMouth: number | undefined;
  if (keyframes.length > 0) {
    const sorted = [...keyframes].sort((a, b) => a.t - b.t);
    if (sorted.length === 1) {
      const kf = sorted[0];
      for (const [jid, off] of Object.entries(kf.jointOffsets)) {
        if (worldJoints[jid]) {
          worldJoints[jid].x += off.x;
          worldJoints[jid].y += off.y;
        }
      }
      if (kf.mouthOpen !== undefined) keyframeMouth = kf.mouthOpen;
    } else {
      let i0 = sorted.length - 1;
      for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].t <= u) i0 = i;
      }
      const i1 = (i0 + 1) % sorted.length;
      const kA = sorted[i0];
      const kB = sorted[i1];
      let span = kB.t - kA.t;
      if (span <= 0) span += 1;
      let rel = u - kA.t;
      if (rel < 0) rel += 1;
      const rawT = span > 1e-5 ? clamp(rel / span, 0, 1) : 0;
      const easeT = rawT * rawT * (3 - 2 * rawT);

      for (const j of rig.joints) {
        if (j.pinned) continue;
        const oA = kA.jointOffsets[j.id];
        const oB = kB.jointOffsets[j.id];
        if (oA || oB) {
          const ax = oA?.x ?? 0,
            ay = oA?.y ?? 0;
          const bx = oB?.x ?? 0,
            by = oB?.y ?? 0;
          worldJoints[j.id].x += ax + (bx - ax) * easeT;
          worldJoints[j.id].y += ay + (by - ay) * easeT;
        }
      }
      if (kA.mouthOpen !== undefined || kB.mouthOpen !== undefined) {
        const mA = kA.mouthOpen ?? 0;
        const mB = kB.mouthOpen ?? 0;
        keyframeMouth = mA + (mB - mA) * easeT;
      }
    }
  }

  // Layer 4: Live Interactive Mouse Drag Offsets (with natural child & elbow/knee follow!)
  for (const j of rig.joints) {
    const live = liveJointOffsets[j.id];
    if (live && (live.x !== 0 || live.y !== 0) && !j.pinned) {
      worldJoints[j.id].x += live.x;
      worldJoints[j.id].y += live.y;
      for (const child of rig.joints) {
        if (child.parentId === j.id && !liveJointOffsets[child.id] && !child.pinned) {
          worldJoints[child.id].x += live.x * 0.85;
          worldJoints[child.id].y += live.y * 0.85;
        }
      }
    }
  }

  // If user drags hand/foot live without directly dragging elbow/knee, bend mid-joint smoothly!
  for (const [midId, endId] of [
    ['l_elbow', 'l_hand'],
    ['r_elbow', 'r_hand'],
    ['l_knee', 'l_foot'],
    ['r_knee', 'r_foot'],
  ] as const) {
    const endLive = liveJointOffsets[endId];
    const midJoint = jointMap.get(midId);
    if (
      endLive &&
      (endLive.x !== 0 || endLive.y !== 0) &&
      !liveJointOffsets[midId] &&
      midJoint &&
      !midJoint.pinned &&
      worldJoints[midId]
    ) {
      worldJoints[midId].x += endLive.x * 0.5;
      worldJoints[midId].y += endLive.y * 0.5;
    }
  }

  // Limb Auto-Aim Rotation: ONLY orient true limb segments (arms & legs) toward their animated child!
  // Never touch pinned joints or head/neck stabilizer groups!
  const LIMB_AUTO_AIM_IDS = new Set([
    'l_shoulder',
    'l_elbow',
    'r_shoulder',
    'r_elbow',
    'l_knee',
    'r_knee',
  ]);

  const childrenCount: Record<string, string[]> = {};
  for (const j of rig.joints) {
    if (j.parentId) {
      if (!childrenCount[j.parentId]) childrenCount[j.parentId] = [];
      childrenCount[j.parentId].push(j.id);
    }
  }

  for (const j of rig.joints) {
    if (j.pinned || !LIMB_AUTO_AIM_IDS.has(j.id)) continue;
    const kids = childrenCount[j.id];
    if (kids && kids.length === 1) {
      const child = jointMap.get(kids[0])!;
      const restDx = child.rest.x - j.rest.x;
      const restDy = child.rest.y - j.rest.y;
      const curDx = worldJoints[child.id].x - worldJoints[j.id].x;
      const curDy = worldJoints[child.id].y - worldJoints[j.id].y;
      if (
        restDx * restDx + restDy * restDy > 1e-5 &&
        curDx * curDx + curDy * curDy > 1e-5
      ) {
        const restAng = Math.atan2(restDy, restDx);
        const curAng = Math.atan2(curDy, curDx);
        let diff = curAng - restAng;
        while (diff > Math.PI) diff -= TAU;
        while (diff < -Math.PI) diff += TAU;
        diff = clamp(diff, -Math.PI * 0.72, Math.PI * 0.72);
        worldRotations[j.id] = diff;
        if (!childrenCount[child.id] && !child.pinned) {
          worldRotations[child.id] = diff * 0.75 + (local[child.id]?.rot ?? 0);
        }
      }
    }
  }

  // Evaluate Mouth / Talking Channel
  const presetMeta = PRESET_ANIMATIONS.find((item) => item.id === p);
  const shouldTalk =
    settings.mouthStyle !== 'none' &&
    (Boolean(presetMeta?.involvesTalking) ||
      settings.talkOverlay ||
      settings.dialogueText.trim().length > 0 ||
      liveMouthOverride !== null ||
      recordedMouth !== undefined ||
      keyframeMouth !== undefined);

  let mouthOpen = 0;
  let mouthWide = 0;
  let viseme: VisemeShape = 'rest';

  if (shouldTalk) {
    const sig = evaluateSpeechSignal(
      u,
      settings.dialogueText,
      p,
      settings.mouthIntensity
    );
    mouthOpen = sig.open;
    mouthWide = sig.wide;
    viseme = sig.viseme;

    if (recordedMouth !== undefined) {
      mouthOpen = clamp(recordedMouth * settings.mouthIntensity, 0, 1.45);
      viseme = mouthOpen > 0.45 ? 'A' : mouthOpen > 0.15 ? 'E' : 'M';
    }
    if (keyframeMouth !== undefined) {
      mouthOpen = clamp(keyframeMouth * settings.mouthIntensity, 0, 1.45);
      viseme = mouthOpen > 0.45 ? 'A' : mouthOpen > 0.15 ? 'E' : 'M';
    }
    if (liveMouthOverride !== null) {
      mouthOpen = clamp(liveMouthOverride * settings.mouthIntensity, 0, 1.5);
      viseme = mouthOpen > 0.5 ? 'A' : mouthOpen > 0.2 ? 'O' : 'rest';
    }
  }

  return {
    worldJoints,
    worldRotations,
    worldScales,
    mouthOpen,
    mouthWide,
    viseme,
    browLift,
    groundLift,
  };
}

/**
 * Updates `mesh.deformedPositions` in-place in < 0.2ms per frame:
 * 1) Applies local-space facial/mouth/jaw warp around `rig.mouth`
 * 2) Applies geodesic multi-bone rigid-blended skeletal skinning
 */
export function deformPuppetMesh(
  mesh: PuppetMesh,
  rig: PuppetRig,
  pose: EvaluatedPose,
  settings: AnimationSettings
): void {
  const numJoints = rig.joints.length;
  if (numJoints === 0 || mesh.vertexCount === 0) return;

  // Precompute per-bone transform components into flat stack arrays for speed
  const restX = new Float32Array(numJoints);
  const restY = new Float32Array(numJoints);
  const animX = new Float32Array(numJoints);
  const animY = new Float32Array(numJoints);
  const mat00 = new Float32Array(numJoints);
  const mat01 = new Float32Array(numJoints);
  const mat10 = new Float32Array(numJoints);
  const mat11 = new Float32Array(numJoints);

  for (let j = 0; j < numJoints; j++) {
    const joint = rig.joints[j];
    const wPos = pose.worldJoints[joint.id] || joint.rest;
    const rot = pose.worldRotations[joint.id] || 0;
    const sc = pose.worldScales[joint.id] || { x: 1, y: 1 };

    restX[j] = joint.rest.x;
    restY[j] = joint.rest.y;
    animX[j] = wPos.x;
    animY[j] = wPos.y;

    const c = Math.cos(rot);
    const s = Math.sin(rot);
    mat00[j] = c * sc.x;
    mat01[j] = -s * sc.y;
    mat10[j] = s * sc.x;
    mat11[j] = c * sc.y;
  }

  const mOpen = pose.mouthOpen;
  const mWide = pose.mouthWide;
  const mStyle = settings.mouthStyle;

  const doFaceWarp =
    mStyle !== 'none' && (mOpen > 0.002 || Math.abs(mWide) > 0.002);
  const compiledMouth = doFaceWarp ? compileMouthGeometry(rig.mouth) : null;

  const restPos = mesh.restPositions;
  const outPos = mesh.deformedPositions;
  const bIdx = mesh.boneIndices;
  const bW = mesh.boneWeights;
  const vCount = mesh.vertexCount;

  for (let v = 0; v < vCount; v++) {
    const v2 = v * 2;
    let vx = restPos[v2];
    let vy = restPos[v2 + 1];

    // Step 1: Rest-space Curved / Custom-Pen Mouth & Jaw Deformation (zero double-mouth!)
    if (doFaceWarp && compiledMouth) {
      const [nvx, nvy] = deformVertexByCustomMouth(
        vx,
        vy,
        compiledMouth,
        mOpen,
        mWide,
        mStyle,
        pose.viseme
      );
      vx = nvx;
      vy = nvy;
    }

    // Step 2: 4-Bone Geodesic Skeletal Skinning
    const b4 = v * 4;
    let fx = 0;
    let fy = 0;

    for (let k = 0; k < 4; k++) {
      const w = bW[b4 + k];
      if (w <= 1e-6) continue;
      const bi = bIdx[b4 + k];
      if (bi >= numJoints) continue;
      const rx = vx - restX[bi];
      const ry = vy - restY[bi];
      const tx = animX[bi] + mat00[bi] * rx + mat01[bi] * ry;
      const ty = animY[bi] + mat10[bi] * rx + mat11[bi] * ry;
      fx += w * tx;
      fy += w * ty;
    }

    outPos[v2] = fx;
    outPos[v2 + 1] = fy;
  }
}

/**
 * Helper: Transforms any point in character rest space (like `rig.mouth.center`)
 * by the Head bone's current animated transform so overlays stay 100% locked to the face.
 */
export function transformHeadPoint(
  pt: Vec2,
  rig: PuppetRig,
  pose: EvaluatedPose
): { pos: Vec2; rot: number; scale: Vec2 } {
  const headJoint =
    rig.joints.find((j) => j.id === 'head') || rig.joints[0];
  if (!headJoint) {
    return { pos: pt, rot: 0, scale: { x: 1, y: 1 } };
  }
  const wPos = pose.worldJoints[headJoint.id] || headJoint.rest;
  const rot = pose.worldRotations[headJoint.id] || 0;
  const sc = pose.worldScales[headJoint.id] || { x: 1, y: 1 };

  const dx = (pt.x - headJoint.rest.x) * sc.x;
  const dy = (pt.y - headJoint.rest.y) * sc.y;
  const c = Math.cos(rot);
  const s = Math.sin(rot);

  return {
    pos: {
      x: wPos.x + dx * c - dy * s,
      y: wPos.y + dx * s + dy * c,
    },
    rot,
    scale: sc,
  };
}

/**
 * Samples body motion energy & mouth openness across [0..1) for visual Timeline curves.
 */
export function sampleTimelineCurves(
  rig: PuppetRig,
  settings: AnimationSettings,
  keyframes: KeyframePoint[],
  recordedSamples: RecordedSample[],
  steps = 64
): { bodyCurve: number[]; mouthCurve: number[] } {
  const bodyCurve: number[] = new Array(steps);
  const mouthCurve: number[] = new Array(steps);

  for (let i = 0; i < steps; i++) {
    const u = i / steps;
    const pose = evaluatePuppetPose(
      rig,
      settings,
      u,
      keyframes,
      recordedSamples
    );

    let maxDisp = 0;
    for (const j of rig.joints) {
      const w = pose.worldJoints[j.id] || j.rest;
      const d = Math.hypot(w.x - j.rest.x, w.y - j.rest.y);
      if (d > maxDisp) maxDisp = d;
    }

    bodyCurve[i] = clamp(maxDisp / 0.14, 0, 1);
    mouthCurve[i] = clamp(pose.mouthOpen / 1.15, 0, 1);
  }

  return { bodyCurve, mouthCurve };
}

/**
 * Converts the currently playing preset / motion into editable KeyframePoints
 * so the user can tweak individual poses or re-time them directly on the Timeline!
 */
export function bakePresetToKeyframes(
  rig: PuppetRig,
  settings: AnimationSettings,
  existingKeyframes: KeyframePoint[] = [],
  recordedSamples: RecordedSample[] = [],
  count = 8
): KeyframePoint[] {
  const result: KeyframePoint[] = [];
  const safeCount = Math.max(4, Math.min(20, count));
  const mGain = Math.max(0.1, settings.mouthIntensity);

  for (let i = 0; i < safeCount; i++) {
    const u = Math.round((i / safeCount) * 1000) / 1000;
    const pose = evaluatePuppetPose(
      rig,
      settings,
      u,
      existingKeyframes,
      recordedSamples
    );
    const offsets: Record<string, Vec2> = {};
    for (const j of rig.joints) {
      const wp = pose.worldJoints[j.id] || j.rest;
      offsets[j.id] = {
        x: wp.x - j.rest.x,
        y: wp.y - j.rest.y,
      };
    }

    result.push({
      id: `kf_bake_${i}_${Date.now().toString(36)}`,
      t: u,
      jointOffsets: offsets,
      mouthOpen: pose.mouthOpen > 0.01 ? pose.mouthOpen / mGain : 0,
    });
  }

  return result;
}
