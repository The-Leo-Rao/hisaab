export const VERT = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const FRAG = `
precision highp float;

uniform vec2 uRes;
uniform float uMorph;
uniform float uLight;
uniform sampler2D uFace;

const float PI = 3.14159265;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return s;
}

float smax(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return max(a, b) + h * h * k * 0.25;
}

float seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * t);
}

float tube(vec2 p, vec2 a, vec2 b, float r0, float r1) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  float d = length(pa - ba * t);
  float r = mix(r0, r1, t);
  return d < r ? sqrt(r * r - d * d) : r - d;
}

float blob(vec2 p, vec2 c, vec2 rad, float ang, float hmax) {
  float cs = cos(ang);
  float sn = sin(ang);
  vec2 q = p - c;
  q = vec2(cs * q.x + sn * q.y, -sn * q.x + cs * q.y) / rad;
  float l = length(q);
  return l < 1.0 ? hmax * sqrt(1.0 - l * l) : hmax * (1.0 - l) * 0.6;
}

float lay(float t, float off) {
  return t + off * smoothstep(0.0, 0.03, t);
}

float hands(vec2 p) {
  vec2 w = vec2(fbm(p * 1.7 + 3.1), fbm(p * 1.7 + 8.4)) - 0.5;
  p += w * 0.1;
  float k = 0.07;
  float h = -1.0;
  h = smax(h, tube(p, vec2(-0.72, -0.36), vec2(-0.42, -0.04), 0.13, 0.18), k);
  h = smax(h, tube(p, vec2(0.72, -0.38), vec2(0.44, -0.06), 0.13, 0.18), k);
  h = smax(h, blob(p, vec2(0.22, -0.02), vec2(0.31, 0.2), -0.35, 0.19), k);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    h = smax(h, lay(tube(p, vec2(0.06, -0.1 - fi * 0.066), vec2(-0.27, -0.17 - fi * 0.05), 0.062, 0.05), 0.01), k);
  }
  h = smax(h, lay(blob(p, vec2(-0.2, 0.06), vec2(0.3, 0.21), 0.45, 0.2), 0.03), k);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 a = vec2(-0.03 + 0.018 * fi, 0.24 - 0.092 * fi);
    vec2 b = a + vec2(0.21, -0.02 - 0.012 * fi);
    vec2 c = b + vec2(0.1, -0.11);
    h = smax(h, lay(tube(p, a, b, 0.056, 0.05), 0.15 - 0.012 * fi), k * 0.3);
    h = smax(h, lay(tube(p, b, c, 0.05, 0.04), 0.13 - 0.012 * fi), k * 0.3);
  }
  h = smax(h, lay(tube(p, vec2(0.3, 0.12), vec2(0.03, 0.3), 0.07, 0.058), 0.19), k * 0.6);
  h = smax(h, lay(tube(p, vec2(0.03, 0.3), vec2(-0.12, 0.31), 0.058, 0.048), 0.19), k * 0.6);
  h = smax(h, lay(tube(p, vec2(-0.3, -0.06), vec2(-0.06, -0.2), 0.076, 0.06), 0.04), k * 0.6);
  return h;
}

float wstroke(vec2 p) {
  vec2 A = vec2(-0.39, 0.06);
  vec2 B = vec2(-0.24, -0.28);
  vec2 C = vec2(-0.01, 0.2);
  vec2 D = vec2(0.14, -0.19);
  vec2 E = vec2(0.43, 0.47);
  float r = 0.085;
  float d = min(min(seg(p, A, B), seg(p, B, C)), min(seg(p, C, D), seg(p, D, E)));
  return sqrt(max(r * r - d * d, 0.0)) / r;
}

float coin(vec2 p) {
  float r = length(p);
  float body = r < 0.8 ? 1.0 : sqrt(max(1.0 - pow((r - 0.8) / 0.04, 2.0), 0.0));
  float h = 0.11 * body;
  h += 0.04 * exp(-pow((r - 0.745) / 0.022, 2.0)) * body;
  h -= 0.008 * smoothstep(0.7, 0.66, r);
  float em = wstroke(p - vec2(0.0, 0.04));
  h += 0.045 * smoothstep(0.0, 0.35, em) * (0.6 + 0.4 * em);
  vec2 uv = vec2(0.5 + 0.5 * p.x, 0.5 - 0.5 * p.y);
  h -= 0.022 * texture2D(uFace, uv).r * step(r, 0.71);
  return h;
}

float ridge(vec2 p) {
  return 1.0 - abs(2.0 * noise(p) - 1.0);
}

float field(vec2 p, out float w, out float crust) {
  float d = length(p);
  float n = fbm(p * 1.4 + 11.0);
  w = smoothstep(0.32, 0.68, uMorph * 2.4 - 0.75 + 0.5 * (n - 0.5) + 0.3 * (0.4 - d));
  crust = sin(PI * w);
  float edge = smoothstep(1.0, 0.95, max(abs(p.x), abs(p.y)));
  float hh = max(hands(p * mix(0.86, 1.6, uMorph) + vec2(0.0, 0.05)), 0.0) * edge;
  float hc = coin(p / mix(0.72, 1.0, uMorph));
  float h = mix(hh, hc, w);
  float grain = 0.65 * ridge(p * 6.0) + 0.35 * fbm(p * 12.0);
  h += crust * 0.035 * grain * smoothstep(0.0, 0.02, h);
  h -= 0.0016 * smoothstep(0.55, 0.85, noise(p * 55.0)) + 0.0007 * noise(p * 130.0);
  return h;
}

vec3 env(vec3 r) {
  float top = smoothstep(-0.1, 0.9, r.y);
  vec3 c = mix(vec3(0.02, 0.025, 0.04), vec3(0.85, 0.88, 0.92), top * top);
  c += vec3(0.55, 0.56, 0.6) * r.z * r.z;
  c += vec3(0.1, 0.65, 0.58) * pow(max(r.x, 0.0), 3.0) * 0.9;
  c += vec3(0.95, 0.55, 0.18) * pow(max(-r.x, 0.0), 3.0) * 0.6;
  c += vec3(1.0) * smoothstep(0.96, 1.0, dot(r, normalize(vec3(-0.3, 0.6, 0.75)))) * 1.5;
  return c;
}

void main() {
  float s = min(uRes.x, uRes.y);
  vec2 p = (2.0 * gl_FragCoord.xy - uRes) / s;
  float e = 2.0 / s;

  float w;
  float crust;
  float h = field(p, w, crust);
  float a = smoothstep(0.002, 0.012, h);
  if (a <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float w1;
  float c1;
  float hx = field(p + vec2(e, 0.0), w1, c1);
  float hy = field(p + vec2(0.0, e), w1, c1);
  vec3 N = normalize(vec3(-(hx - h) / e * 0.85, -(hy - h) / e * 0.85, 1.0));
  vec3 V = vec3(0.0, 0.0, 1.0);

  vec3 L1 = normalize(vec3(cos(uLight) * 0.55 - 0.25, 0.55 + sin(uLight) * 0.25, 0.8));
  vec3 L2 = normalize(vec3(0.9, 0.1, 0.3));

  float patina = fbm(p * 5.0 + 2.0);
  float rustM = 0.55 * smoothstep(0.6, 0.78, fbm(p * 3.3 + vec2(4.0, 1.0))) * (1.0 - smoothstep(0.04, 0.16, h));
  float rough = clamp(mix(0.3, 0.85, rustM) + 0.12 * noise(p * 30.0), 0.0, 1.0);

  vec3 steel = vec3(0.7, 0.68, 0.65);
  vec3 iron = vec3(0.3, 0.29, 0.28);
  vec3 rust = vec3(0.36, 0.16, 0.07);
  vec3 base = mix(mix(iron, steel, patina), rust, rustM);

  vec3 R = reflect(-V, N);
  vec3 envR = mix(env(R), vec3(0.3, 0.31, 0.33), rough * 0.7);
  float nv = max(dot(N, V), 0.0);
  vec3 fres = base + (1.0 - base) * pow(1.0 - nv, 5.0);
  float ndl = max(dot(N, L1), 0.0);
  vec3 Hv = normalize(L1 + V);
  float spec = pow(max(dot(N, Hv), 0.0), mix(90.0, 12.0, rough)) * mix(1.2, 0.25, rough);

  vec3 col = fres * envR * mix(1.0, 0.45, rustM);
  col += base * spec * vec3(1.0, 0.96, 0.9);
  col += base * 0.12 * ndl;
  col = mix(col, rust * (0.15 + 0.7 * ndl), rustM * 0.7);
  col += vec3(0.1, 0.7, 0.6) * pow(max(dot(N, L2), 0.0), 6.0) * 0.18;

  float glow = crust * crust * smoothstep(0.55, 0.92, 1.0 - ridge(p * 6.0));
  col += vec3(1.0, 0.36, 0.08) * glow * 0.35;

  float ao = clamp(0.5 + h * 2.4, 0.0, 1.0);
  col *= ao;
  col = 1.0 - exp(-col * 1.6);
  gl_FragColor = vec4(col * a, a);
}
`;
