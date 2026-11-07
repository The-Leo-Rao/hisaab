export const VERT = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const FRAG = `
precision highp float;

uniform vec2 uRes;
uniform float uAngle;
uniform sampler2D uFace;

const float R = 0.8;
const float RE = 0.83;
const float T = 0.11;

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

float seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * t);
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

float face(vec2 q) {
  float r = length(q);
  float body = r < R ? 1.0 : sqrt(max(1.0 - pow((r - R) / (RE - R), 2.0), 0.0));
  float h = 0.11 * body;
  h += 0.04 * exp(-pow((r - 0.745) / 0.022, 2.0)) * body;
  h -= 0.008 * smoothstep(0.7, 0.66, r);
  float em = wstroke(q - vec2(0.0, 0.04));
  h += 0.045 * smoothstep(0.0, 0.35, em) * (0.6 + 0.4 * em);
  vec2 uv = vec2(0.5 + 0.5 * q.x, 0.5 - 0.5 * q.y);
  h -= 0.022 * texture2D(uFace, uv).r * step(r, 0.71);
  h -= 0.0014 * smoothstep(0.55, 0.85, noise(q * 55.0)) + 0.0006 * noise(q * 130.0);
  return h;
}

vec3 env(vec3 r) {
  float top = smoothstep(-0.1, 0.9, r.y);
  vec3 c = mix(vec3(0.02, 0.02, 0.025), vec3(0.9, 0.88, 0.84), top * top);
  c += vec3(0.5, 0.48, 0.45) * r.z * r.z;
  c += vec3(1.0, 0.72, 0.28) * pow(max(-r.x, 0.0), 3.0) * 0.7;
  c += vec3(0.75, 0.78, 0.85) * pow(max(r.x, 0.0), 3.0) * 0.5;
  c += vec3(1.0) * smoothstep(0.96, 1.0, dot(r, normalize(vec3(-0.3, 0.6, 0.75)))) * 1.6;
  return c;
}

vec3 shade(vec3 N, vec3 base, float rough) {
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 L = normalize(vec3(-0.35, 0.6, 0.75));
  vec3 Rv = reflect(-V, N);
  vec3 envR = mix(env(Rv), vec3(0.3), rough * 0.6);
  float nv = max(dot(N, V), 0.0);
  vec3 fres = base + (1.0 - base) * pow(1.0 - nv, 5.0);
  float spec = pow(max(dot(N, normalize(L + V)), 0.0), mix(90.0, 14.0, rough)) * mix(1.2, 0.3, rough);
  vec3 col = fres * envR + base * spec + base * 0.1 * max(dot(N, L), 0.0);
  return 1.0 - exp(-col * 1.5);
}

vec3 materialAt(vec2 q, out float rough) {
  float r = length(q);
  float gold = smoothstep(0.25, 0.6, wstroke(q - vec2(0.0, 0.04)));
  gold = max(gold, smoothstep(0.035, 0.012, abs(r - 0.745)) * step(r, R + 0.01));
  vec3 charcoal = mix(vec3(0.16, 0.16, 0.17), vec3(0.26, 0.25, 0.25), fbm(q * 5.0));
  vec3 goldTone = mix(vec3(0.95, 0.62, 0.16), vec3(1.0, 0.8, 0.42), clamp(q.x * 0.6 + 0.5, 0.0, 1.0));
  rough = mix(0.42, 0.22, gold) + 0.1 * noise(q * 30.0);
  return mix(charcoal, goldTone, gold);
}

void main() {
  float s = min(uRes.x, uRes.y);
  vec2 p = (2.0 * gl_FragCoord.xy - uRes) / s * 1.06;
  float e = 2.0 / s;

  float c = cos(uAngle);
  float sn = sin(uAngle);
  float cp = max(abs(c), 0.002);
  float sp = c < 0.0 ? -sn : sn;

  float ox = 0.5 * T * sp;
  vec2 q = vec2((p.x - ox) / cp, p.y);
  float h = face(q);
  float aFace = smoothstep(0.002, 0.012, h) * step(length(q), RE + 0.01);

  vec3 col = vec3(0.0);
  float a = 0.0;

  float ry = clamp(p.y / RE, -1.0, 1.0);
  float cb = (sp > 0.0 ? -1.0 : 1.0) * sqrt(1.0 - ry * ry);
  float xc = cb * RE * cp;
  float band = 0.5 * T * abs(sp);
  float dEdge = abs(p.x - xc) - band;
  float aEdge = smoothstep(e * 1.5, -e * 0.5, dEdge) * step(abs(p.y), RE);
  if (aEdge > 0.0) {
    vec3 n = normalize(vec3(cb * cp, ry, -cb * sp));
    n.y += 0.18 * sin(p.y * 260.0);
    n = normalize(n);
    vec3 base = mix(vec3(0.85, 0.58, 0.18), vec3(0.55, 0.38, 0.14), noise(p * 40.0));
    col = shade(n, base, 0.35) * 0.85;
    a = aEdge;
  }

  if (aFace > 0.0) {
    float hx = face(q + vec2(e, 0.0));
    float hy = face(q + vec2(0.0, e));
    vec3 nl = normalize(vec3(-(hx - h) / e * 0.85, -(hy - h) / e * 0.85, 1.0));
    vec3 n = normalize(vec3(nl.x * cp + nl.z * sp, nl.y, -nl.x * sp + nl.z * cp));
    float rough;
    vec3 base = materialAt(q, rough);
    vec3 fc = shade(n, base, rough) * clamp(0.55 + h * 2.6, 0.0, 1.0);
    col = mix(col, fc, aFace);
    a = max(a, aFace);
  }

  gl_FragColor = vec4(col * a, a);
}
`;
