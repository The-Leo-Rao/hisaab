"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { drawCoinFace } from "./coinFace";
import { FRAG, VERT } from "./shader";

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader failed");
  return s;
}

function program(gl: WebGLRenderingContext) {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link failed");
  return p;
}

function monoFamily() {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-mono").trim();
  return v || "ui-monospace, monospace";
}

const SPIN = 12;

export function MetalCoin({ className, still }: { className?: string; still?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, antialias: false, alpha: true });
    if (!gl) return setFailed(true);

    let prog: WebGLProgram;
    try {
      prog = program(gl);
    } catch {
      return setFailed(true);
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array([0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const uRes = gl.getUniformLocation(prog, "uRes");
    const uAngle = gl.getUniformLocation(prog, "uAngle");
    gl.uniform1i(gl.getUniformLocation(prog, "uFace"), 0);

    let live = true;
    let visible = true;
    let raf = 0;
    const start = performance.now();
    const animate = !reduced && still === undefined;

    const draw = (seconds: number) => {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uAngle, still ?? (animate ? ((seconds % SPIN) / SPIN) * Math.PI * 2 : 0.35));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    const frame = (now: number) => {
      if (!live) return;
      if (visible && document.visibilityState === "visible") {
        fit();
        draw((now - start) / 1000);
      }
      raf = requestAnimationFrame(frame);
    };

    document.fonts.ready.then(() => {
      if (!live) return;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, gl.LUMINANCE, gl.UNSIGNED_BYTE, drawCoinFace("hisaab.eth", monoFamily()));
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      if (!animate) {
        fit();
        draw(0);
      }
    });

    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(canvas);
    const ro = new ResizeObserver(() => {
      if (!animate) {
        fit();
        draw(0);
      }
    });
    ro.observe(canvas);

    if (animate) raf = requestAnimationFrame(frame);
    else {
      fit();
      draw(0);
    }

    return () => {
      live = false;
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      gl.deleteTexture(tex);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    };
  }, [reduced, still]);

  if (failed) return null;
  return <canvas ref={ref} className={cn("block size-full", className)} role="img" aria-label="A rotating metal coin stamped hisaab.eth" />;
}
