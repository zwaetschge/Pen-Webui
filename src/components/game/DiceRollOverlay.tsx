"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import * as THREE from "three";
import {
  dieGeometryKind,
  latestDiceRoll,
  visibleDiceForRoll,
  type DiceRollLine,
} from "@/lib/game/dice-visual";
import { useGame, type VisualDie } from "@/lib/game/store";
import { cn } from "@/lib/cn";

const DISPLAY_MS = 2800;
const MAX_VISIBLE_DICE = 8;

export function DiceRollOverlay() {
  const latestRoll = useGame((s) => latestDiceRoll(s.chat));
  const [activeRoll, setActiveRoll] = useState<DiceRollLine | null>(null);
  const [visible, setVisible] = useState(false);
  const [rendererUnavailable, setRendererUnavailable] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reducedMotion = useReducedMotionPreference();

  useEffect(() => {
    if (!latestRoll) return;
    setActiveRoll((current) => {
      if (current?.id === latestRoll.id) return current;
      return latestRoll;
    });
    setRendererUnavailable(false);
    setVisible(true);
    const timeout = window.setTimeout(() => setVisible(false), DISPLAY_MS);
    return () => window.clearTimeout(timeout);
  }, [latestRoll?.id, latestRoll]);

  const prepared = useMemo(
    () =>
      activeRoll ? visibleDiceForRoll(activeRoll, MAX_VISIBLE_DICE) : null,
    [activeRoll],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activeRoll || !prepared || !visible) return;
    const cleanup = renderDiceCanvas(canvas, prepared.dice, reducedMotion);
    if (!cleanup) {
      setRendererUnavailable(true);
      return;
    }
    return cleanup;
  }, [activeRoll, prepared, reducedMotion, visible]);

  if (!activeRoll || !prepared || !visible) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center px-4"
      role="status"
      aria-live="polite"
    >
      <div className="dice-roll-overlay relative w-[min(92vw,34rem)] overflow-hidden rounded-md border border-brass-400/45 bg-ink-700/78 px-4 pb-4 pt-3 shadow-[0_28px_80px_rgba(0,0,0,0.55)] backdrop-blur-md">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-display text-[10px] uppercase tracking-[0.28em] text-brass-300">
              Würfelwurf
            </p>
            <p className="mt-1 truncate text-sm text-ink-100">
              {activeRoll.displayName ??
                (activeRoll.actor === "dm" ? "DM" : "Spieler")}{" "}
              · {activeRoll.notation}
            </p>
          </div>
          <div className="shrink-0 rounded border border-brass-400/60 bg-brass-700/45 px-3 py-1 font-display text-2xl text-parchment-50 shadow-brass">
            {activeRoll.total}
          </div>
        </div>

        {rendererUnavailable ? (
          <CssDiceStage
            dice={prepared.dice}
            reducedMotion={reducedMotion}
            rollId={activeRoll.id}
          />
        ) : (
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            className="mt-1 h-40 w-full sm:h-48"
          />
        )}

        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {prepared.dice.map((die, index) => (
            <span
              key={`${activeRoll.id}-${index}`}
              className={cn(
                "rounded border px-2 py-0.5 font-display text-[11px]",
                die.dropped
                  ? "border-ink-200/30 bg-ink-600/45 text-ink-200 line-through"
                  : "border-brass-700/60 bg-ink-600/75 text-brass-200",
              )}
            >
              W{die.sides}: {die.value}
            </span>
          ))}
          {prepared.extraCount > 0 ? (
            <span className="rounded border border-brass-700/40 bg-ink-600/60 px-2 py-0.5 font-display text-[11px] text-ink-100">
              +{prepared.extraCount}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CssDiceStage({
  dice,
  reducedMotion,
  rollId,
}: {
  dice: VisualDie[];
  reducedMotion: boolean;
  rollId: string;
}) {
  return (
    <div
      aria-hidden="true"
      className="dice-css-stage mt-2 flex h-40 items-center justify-center gap-3 overflow-hidden sm:h-48 sm:gap-4"
    >
      {dice.map((die, index) => (
        <div
          key={`${rollId}-${index}`}
          className={cn(
            "dice-css-die relative grid h-16 w-16 place-items-center border border-brass-200/50 bg-brass-600 text-ink-700 shadow-[0_16px_30px_rgba(0,0,0,0.42)] sm:h-20 sm:w-20",
            !reducedMotion && "dice-css-die-animate",
            die.dropped && "dice-css-die-dropped border-ink-200/35 bg-ink-300 text-ink-600 opacity-70",
          )}
          style={diceCssStyle(die, index)}
        >
          <span className="absolute left-1.5 top-1.5 font-display text-[9px] uppercase text-ink-600/70 sm:text-[10px]">
            W{die.sides}
          </span>
          <strong className="font-display text-2xl leading-none sm:text-3xl">
            {die.value}
          </strong>
        </div>
      ))}
    </div>
  );
}

export function renderDiceCanvas(
  canvas: HTMLCanvasElement,
  dice: VisualDie[],
  reducedMotion: boolean,
): (() => void) | null {
  const context = webGlContextFor(canvas);
  if (!context) return null;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      context,
      alpha: true,
      antialias: true,
    });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(0, 0.7, 6);

  scene.add(new THREE.AmbientLight(0xfff0c6, 1.15));
  const key = new THREE.DirectionalLight(0xffcf76, 2.4);
  key.position.set(-2, 3, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7ec8ff, 1.2);
  rim.position.set(3, 2, 2);
  scene.add(rim);

  const meshes = dice.map((die, index) => {
    const geometry = geometryForDie(die.sides);
    const material = new THREE.MeshStandardMaterial({
      color: die.dropped ? 0x5a5348 : 0xb98b45,
      emissive: die.dropped ? 0x050505 : 0x1e1206,
      roughness: 0.42,
      metalness: 0.25,
      transparent: die.dropped,
      opacity: die.dropped ? 0.46 : 1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    const offset = index - (dice.length - 1) / 2;
    mesh.position.set(offset * dieSpacing(dice.length), 0, 0);
    mesh.rotation.set(seedRotation(die.value), seedRotation(die.sides), 0);
    scene.add(mesh);
    return mesh;
  });

  let frame = 0;
  let animation = 0;
  let disposed = false;
  const started = performance.now();
  const duration = reducedMotion ? 1 : 1550;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener("resize", resize);

  const render = (now: number) => {
    if (disposed) return;
    const t = Math.min(1, (now - started) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    meshes.forEach((mesh, index) => {
      const die = dice[index];
      mesh.rotation.x =
        seedRotation(die.value) + (1 - eased) * Math.PI * (4 + index);
      mesh.rotation.y =
        seedRotation(die.sides) + (1 - eased) * Math.PI * (3 + index * 0.5);
      mesh.rotation.z = (1 - eased) * Math.PI * 2;
      mesh.position.y =
        reducedMotion || t >= 1
          ? 0
          : Math.sin(t * Math.PI) * (0.55 + index * 0.03);
    });
    renderer.render(scene, camera);
    if (t < 1) {
      animation = window.requestAnimationFrame(render);
    } else if (frame < 18) {
      frame += 1;
      animation = window.requestAnimationFrame(render);
    }
  };
  animation = window.requestAnimationFrame(render);

  return () => {
    disposed = true;
    window.cancelAnimationFrame(animation);
    window.removeEventListener("resize", resize);
    meshes.forEach((mesh) => {
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((material) => material.dispose());
      } else {
        mesh.material.dispose();
      }
      scene.remove(mesh);
    });
    renderer.dispose();
  };
}

function webGlContextFor(canvas: HTMLCanvasElement) {
  const attributes: WebGLContextAttributes = {
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  };

  try {
    return (
      canvas.getContext("webgl2", attributes) ??
      canvas.getContext("webgl", attributes)
    );
  } catch {
    return null;
  }
}

function diceCssStyle(die: VisualDie, index: number): CSSProperties {
  const rest = [
    `rotateX(${18 + ((die.value * 17) % 42)}deg)`,
    `rotateY(${-28 + ((die.sides * 13) % 56)}deg)`,
    `rotateZ(${-10 + index * 7}deg)`,
  ].join(" ");

  return {
    "--die-rest": rest,
    animationDelay: `${index * 70}ms`,
  } as CSSProperties;
}

function geometryForDie(sides: number): THREE.BufferGeometry {
  switch (dieGeometryKind(sides)) {
    case "d4":
      return new THREE.TetrahedronGeometry(0.78);
    case "d6":
      return new THREE.BoxGeometry(1.08, 1.08, 1.08);
    case "d8":
      return new THREE.OctahedronGeometry(0.82);
    case "d10":
      return new THREE.CylinderGeometry(0.62, 0.62, 1.02, 10);
    case "d12":
      return new THREE.DodecahedronGeometry(0.82);
    case "d20":
      return new THREE.IcosahedronGeometry(0.84);
    case "generic":
      return new THREE.IcosahedronGeometry(0.8);
  }
}

function dieSpacing(count: number) {
  if (count <= 2) return 1.42;
  if (count <= 4) return 1.18;
  return 0.9;
}

function seedRotation(value: number) {
  return ((value * 47) % 360) * (Math.PI / 180);
}

function useReducedMotionPreference() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}
