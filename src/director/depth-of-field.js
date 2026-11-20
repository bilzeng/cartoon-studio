import * as T from "three";
import { defaultFocusDistance, focalLengthForFov } from "../../shared/stage-lens";

export function createDepthOfField() {
  const uniforms = {
    colorMap:{value:null}, depthMap:{value:null}, viewportSize:{value:new T.Vector2()},
    nearClip:{value:.04}, farClip:{value:300}, focus:{value:5}, strength:{value:0},
  };
  const material = new T.ShaderMaterial({
    uniforms, depthTest:false, depthWrite:false, toneMapped:false,
    vertexShader:`varying vec2 texCoord;
      void main() { texCoord = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader:`varying vec2 texCoord;
      uniform sampler2D colorMap, depthMap;
      uniform vec2 viewportSize;
      uniform float nearClip, farClip, focus, strength;
      void main() {
        float depth = texture2D(depthMap, texCoord).x;
        float distance = nearClip * farClip / (farClip - (farClip - nearClip) * depth);
        float radius = min(0.02, abs(1.0 / distance - 1.0 / focus) * strength);
        vec2 offset = radius * vec2(viewportSize.y / viewportSize.x, 1.0);
        vec4 color = texture2D(colorMap, texCoord) * 2.0;
        for (int i = 0; i < 12; i++) {
          float angle = float(i) * 2.399963;
          vec2 direction = vec2(cos(angle), sin(angle)) * sqrt((float(i) + .5) / 12.0);
          color += texture2D(colorMap, texCoord + direction * offset);
        }
        gl_FragColor = color / 14.0;
        #include <colorspace_fragment>
      }`,
  });
  const screen = new T.Scene(), camera = new T.Camera();
  const quad = new T.Mesh(new T.PlaneGeometry(2,2),material);
  quad.frustumCulled = false;
  screen.add(quad);
  const viewport = new T.Vector4(), scissor = new T.Vector4();
  let target;
  return {
    render(renderer, world, shot, lens) {
      if (lens?.aperture == null) { renderer.render(world,shot); return; }
      renderer.getViewport(viewport); renderer.getScissor(scissor);
      const scissorTest = renderer.getScissorTest(), dpr = renderer.getPixelRatio();
      const w = Math.max(1,Math.round(viewport.z*dpr)), h = Math.max(1,Math.round(viewport.w*dpr));
      target ??= new T.WebGLRenderTarget(w,h,{depthTexture:new T.DepthTexture(w,h)});
      target.setSize(w,h);
      renderer.setRenderTarget(target);
      try { renderer.render(world,shot); }
      finally {
        renderer.setRenderTarget(null);
        renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest);
      }
      uniforms.colorMap.value = target.texture;
      uniforms.depthMap.value = target.depthTexture;
      uniforms.viewportSize.value.set(w,h);
      uniforms.nearClip.value = shot.near; uniforms.farClip.value = shot.far;
      uniforms.focus.value = lens.focusDistance ?? defaultFocusDistance;
      uniforms.strength.value = .045 * (8/lens.aperture) * Math.min(3,focalLengthForFov(shot.fov)/40);
      renderer.render(screen,camera);
    },
    dispose() { target?.dispose(); quad.geometry.dispose(); material.dispose(); },
  };
}
