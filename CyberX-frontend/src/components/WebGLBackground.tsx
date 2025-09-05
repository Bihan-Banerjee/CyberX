import React, { useRef, useEffect } from 'react';

interface WebGLBackgroundProps {
  className?: string;
}

const WebGLBackground: React.FC<WebGLBackgroundProps> = ({ className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

  const vertexShaderSource = `
    attribute vec4 a_position;
    void main() {
      gl_Position = a_position;
    }
  `;

  const fragmentShaderSource = `
    precision mediump float;
    #define TWO_PI 6.28318530718

    uniform vec2 u_resolution;
    uniform float u_time;
    uniform vec2 u_colsrows;

    float HueToRGB(float f1, float f2, float hue) {
      if (hue < 0.0) hue += 1.0;
      else if (hue > 1.0) hue -= 1.0;
      float res;
      if ((6.0 * hue) < 1.0)
        res = f1 + (f2 - f1) * 6.0 * hue;
      else if ((2.0 * hue) < 1.0)
        res = f2;
      else if ((3.0 * hue) < 2.0)
        res = f1 + (f2 - f1) * ((2.0 / 3.0) - hue) * 6.0;
      else
        res = f1;
      return res;
    }

    vec3 HSLToRGB(vec3 hsl) {
      vec3 rgb;
      if (hsl.y == 0.0)
        rgb = vec3(hsl.z);
      else {
        float f2;
        if (hsl.z < 0.5)
          f2 = hsl.z * (1.0 + hsl.y);
        else
          f2 = (hsl.z + hsl.y) - (hsl.y * hsl.z);

        float f1 = 2.0 * hsl.z - f2;
        rgb.r = HueToRGB(f1, f2, hsl.x + (1.0/3.0));
        rgb.g = HueToRGB(f1, f2, hsl.x);
        rgb.b = HueToRGB(f1, f2, hsl.x - (1.0/3.0));
      }
      return rgb;
    }

    mat2 rotate2d(float angle) {
      return mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
    }

    vec2 rotateFrom(vec2 uv, vec2 center, float angle) {
      vec2 uv_ = uv - center;
      uv_ = rotate2d(angle) * uv_;
      return uv_ + center;
    }

    float random(float value) {
      return fract(sin(value) * 43758.5453123);
    }

    float random(vec2 tex) {
      return fract(sin(dot(tex.xy, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    vec2 random2D(vec2 uv) {
      uv = vec2(dot(uv, vec2(127.1, 311.7)), dot(uv, vec2(269.5, 183.3)));
      return fract(sin(uv) * 43758.5453123);
    }

    vec3 random3D(vec3 uv) {
      uv = vec3(
        dot(uv, vec3(127.1, 311.7, 120.9898)),
        dot(uv, vec3(269.5, 183.3, 150.457)),
        dot(uv, vec3(380.5, 182.3, 170.457))
      );
      return -1.0 + 2.0 * fract(sin(uv) * 43758.5453123);
    }

    float cubicCurve(float value) {
      return value * value * (3.0 - 2.0 * value);
    }

    vec2 cubicCurve(vec2 value) {
      return value * value * (3.0 - 2.0 * value);
    }

    // NEW: vec3 overload to replace missing cubicCurve3
    vec3 cubicCurve(vec3 value) {
      return value * value * (3.0 - 2.0 * value);
    }

    float noise(vec2 uv) {
      vec2 iuv = floor(uv);
      vec2 fuv = fract(uv);
      vec2 suv = cubicCurve(fuv);

      float dotAA = dot(random2D(iuv + vec2(0.0)), fuv - vec2(0.0));
      float dotBB = dot(random2D(iuv + vec2(1.0, 0.0)), fuv - vec2(1.0, 0.0));
      float dotCC = dot(random2D(iuv + vec2(0.0, 1.0)), fuv - vec2(0.0, 1.0));
      float dotDD = dot(random2D(iuv + vec2(1.0, 1.0)), fuv - vec2(1.0, 1.0));

      return mix(mix(dotAA, dotBB, suv.x), mix(dotCC, dotDD, suv.x), suv.y);
    }

    float noise(vec3 uv) {
      vec3 iuv = floor(uv);
      vec3 fuv = fract(uv);
      vec3 suv = cubicCurve(fuv); // replaced cubicCurve3

      float dotAA = dot(random3D(iuv + vec3(0.0)), fuv - vec3(0.0));
      float dotBB = dot(random3D(iuv + vec3(1.0, 0.0, 0.0)), fuv - vec3(1.0, 0.0, 0.0));
      float dotCC = dot(random3D(iuv + vec3(0.0, 1.0, 0.0)), fuv - vec3(0.0, 1.0, 0.0));
      float dotDD = dot(random3D(iuv + vec3(1.0, 1.0, 0.0)), fuv - vec3(1.0, 1.0, 0.0));

      float dotEE = dot(random3D(iuv + vec3(0.0, 0.0, 1.0)), fuv - vec3(0.0, 0.0, 1.0));
      float dotFF = dot(random3D(iuv + vec3(1.0, 0.0, 1.0)), fuv - vec3(1.0, 0.0, 1.0));
      float dotGG = dot(random3D(iuv + vec3(0.0, 1.0, 1.0)), fuv - vec3(0.0, 1.0, 1.0));
      float dotHH = dot(random3D(iuv + vec3(1.0, 1.0, 1.0)), fuv - vec3(1.0, 1.0, 1.0));

      float passH0 = mix(mix(dotAA, dotBB, suv.x), mix(dotCC, dotDD, suv.x), suv.y);
      float passH1 = mix(mix(dotEE, dotFF, suv.x), mix(dotGG, dotHH, suv.x), suv.y);

      return mix(passH0, passH1, suv.z);
    }

    float rect(vec2 uv, vec2 length, float smooth) {
      float dx = abs(uv.x - 0.5);
      float dy = abs(uv.y - 0.5);
      float lenx = 1.0 - smoothstep(length.x - smooth, length.x + smooth, dx);
      float leny = 1.0 - smoothstep(length.y - smooth, length.y + smooth, dy);
      return lenx * leny;
    }

    vec4 addGrain(vec2 uv, float time, float grainIntensity) {
      float grain = random(fract(uv * time)) * grainIntensity;
      return vec4(vec3(grain), 1.0);
    }

    vec2 fishey(vec2 uv, vec2 center, float ratio, float dist) {
      vec2 puv = uv + vec2(1.0);
      vec2 m = vec2(center.x, center.y/ratio) + vec2(1.0);
      vec2 d = puv - m;
      float r = sqrt(dot(d, d));
      float power = (TWO_PI / (2.0 * sqrt(dot(m, m)))) * mix(0.1, 0.4, pow(dist, 0.75));
      float bind;
      if (power > 0.0) bind = sqrt(dot(m, m));

      vec2 nuv;
      if (power > 0.0)
        nuv = m + normalize(d) * tan(r * power) * bind / tan(bind * power);
      else if (power < 0.0)
        nuv = m + normalize(d) * atan(r * -power * 10.0) * bind / atan(-power * bind * 10.0);
      else
        nuv = puv;

      return nuv - vec2(1.0);
    }

    float addStreamLine(vec2 uv, float rows, float height, float smooth) {
      vec2 uvstream = uv * vec2(1.0, rows);
      float distFromCenter = abs(0.5 - fract(uvstream.y));
      float edge = smoothstep(height - smooth*0.5, height + smooth*0.5, distFromCenter);
      return edge;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution.xy;
      vec2 ouv = uv;
      float ratio = u_resolution.x / u_resolution.y;

      float horizontalGlitch = sin(random(uv.y) * TWO_PI);
      float noiseAmp = noise(vec2(uv.y + u_time * horizontalGlitch));
      float minAmp = 0.001;
      float maxAmp = 0.005;
      float amp = mix(minAmp, maxAmp, noiseAmp);
      uv.x = fract(uv.x + amp);

      uv = fishey(uv, vec2(0.5, 0.5/ratio), 1.0, 2.0);
      uv = rotateFrom(uv, vec2(0.5, 0.5 * ratio), u_time * 0.01);

      float indexCol = floor(uv.x * (u_colsrows.x * 2.0)/ratio);
      float randColIndex = random(indexCol);
      float orientation = randColIndex * 2.0 - 1.0;
      float minSpeed = 0.1;
      float maxSpeed = 0.5;
      float speed = mix(minSpeed, maxSpeed, randColIndex);

      uv.y += u_time * speed * orientation;
      uv.y += floor(u_time);

      vec2 nuv = uv * vec2(u_colsrows.x, u_colsrows.x / ratio);
      vec2 fuv = fract(nuv);
      vec2 iuv = floor(nuv);

      float sub = 0.0;
      for (int i = 0; i < 4; i++) {
        float randRatio = random(iuv + floor(u_time));
        float noiseRatio = sin(noise(vec3(iuv * 0.05, u_time)) * (TWO_PI * 0.5)) * 0.5;
        if (randRatio + noiseRatio > 0.5) {
          nuv = fuv * vec2(3.0);
          fuv = fract(nuv);
          iuv += floor(nuv + float(i));
          sub += 1.0;
        }
      }

      float indexRatio = step(2.0, sub);
      float index = random(iuv);
      float isLight = step(0.5, index) * indexRatio;

      float randIndex = random(iuv * 0.01 + floor(u_time));
      float minSize = 0.05;
      float maxSize = 0.35;
      float size = mix(minSize, maxSize, randIndex);

      float shape = rect(fuv, vec2(size), 0.01) * isLight;

      // FIX: use noise(vec2 ...) instead of undefined noise2D(...)
      float shiftNoiseAnimation = noise(iuv * (u_time * 0.1)) * 0.25;
      float shiftRandomAnimation = random(vec2(u_time)) * 0.01;
      vec2 offset = vec2(shiftRandomAnimation + shiftNoiseAnimation, 0.0);
      float shapeRed = rect(fuv - offset, vec2(size), 0.01);
      float shapeGreen = rect(fuv + offset, vec2(size), 0.01);
      float shapeBlue = rect(fuv, vec2(size), 0.01);

      float minHue = 0.6;
      float maxHue = 1.0;
      float hue = mix(minHue, maxHue, randIndex);

      float randIndex2 = random(iuv * 0.5 + floor(u_time));
      float minLightness = 0.65;
      float maxLightness = 0.85;
      float lightness = mix(minLightness, maxLightness, randIndex2);

      vec3 background = HSLToRGB(vec3(336.0/360.0, 0.75, 0.075));
      vec3 foreground = HSLToRGB(vec3(hue, 1.0, lightness));

      vec3 shapeShift = vec3(shapeRed, shapeGreen, shapeBlue) * shape;
      vec3 final = mix(background, foreground, shapeShift);

      float randGrain = random(u_time * 0.001);
      vec4 grain = addGrain(uv, u_time, 0.05 + randGrain * 0.05);

      vec2 souv = fract(ouv + vec2(0.0, u_time * 0.05));
      float brightness = sin(souv.y * TWO_PI * 2.0);
      float vhsLines = addStreamLine(souv, 200.0, 0.35, 0.01) * brightness;

      gl_FragColor = vec4(final, 1.0) + vhsLines * 0.05 + grain;
    }
  `;

  const createShader = (gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  };

  const createProgram = (gl: WebGLRenderingContext, vertexShader: WebGLShader, fragmentShader: WebGLShader): WebGLProgram | null => {
    const program = gl.createProgram();
    if (!program) return null;

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }

    return program;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl');
    if (!gl) {
      console.error('WebGL not supported');
      return;
    }

    // Create shaders
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    if (!vertexShader || !fragmentShader) return;

    // Create program
    const program = createProgram(gl, vertexShader, fragmentShader);
    if (!program) return;

    // Set up geometry (full screen quad)
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
        -1,  1,
         1, -1,
         1,  1,
      ]),
      gl.STATIC_DRAW
    );

    // Get attribute and uniform locations
    const positionLocation = gl.getAttribLocation(program, 'a_position');
    const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
    const timeLocation = gl.getUniformLocation(program, 'u_time');
    const colsRowsLocation = gl.getUniformLocation(program, 'u_colsrows');

    const startTime = Date.now();

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    resize();
    window.addEventListener('resize', resize);

    const render = () => {
      const currentTime = (Date.now() - startTime) / 1000;

      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(program);

      // Set up position attribute
      gl.enableVertexAttribArray(positionLocation);
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

      // Set uniforms
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
      gl.uniform1f(timeLocation, currentTime);
      gl.uniform2f(colsRowsLocation, 3.0, 2.0);

      // Draw
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationRef.current);
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      gl.deleteBuffer(positionBuffer);
    };
  }, []);

  return (
  <canvas
    ref={canvasRef}
    className="fixed inset-0 z-0 pointer-events-none w-screen h-screen"
  />
);

};

export default WebGLBackground;
