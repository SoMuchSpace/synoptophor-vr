class Vr {

    rotationY = 0;
    rotationX = 0;

    _vertexShader = `
        attribute vec3 a_VertexPosition;
        attribute vec2 a_TextureCoordinates;

        uniform mat4 u_ViewMatrix;
        uniform mat4 u_ProjectionMatrix;

        varying vec2 v_TextureCoordinates;

        void main() {
            gl_Position = u_ProjectionMatrix * u_ViewMatrix * vec4(a_VertexPosition, 1.0);
            v_TextureCoordinates = a_TextureCoordinates;
        }
    `;

    _fragmentShader = `
        precision mediump float;

        uniform sampler2D u_Texture;

        varying vec2 v_TextureCoordinates;

        void main() {
            gl_FragColor = texture2D(u_Texture, v_TextureCoordinates);
        }
    `;

    _canvas = null;

    _gl = null;
    _glLayer = null;
    _program = null;
    _vertexBuffer = null;
    _textureBuffer = null;
    _uProjectionMatrixLocation = null;
    _aVertexPositionLocation = null;
    _aTextureCoordinatesLocation = null;
    _uTextureLocation = null;
    _uViewMatrixLocation = null;

    _xrSession = null;
    _xrReferenceSpace = null;
    _xrAnimationFrameRequestID = null;

    _animation = null;
    _animationAbortController = null;

    constructor(canvas) {
        this._canvas = canvas;
    }

    async startXrSession() {
        const XR = navigator.xr;
        if (!XR) {
            throw new Error("WebXR not supported");
        }
        if (!await XR.isSessionSupported("immersive-vr")) {
            throw new Error("Immersive VR not supported");
        }

        this._gl = canvas.getContext("webgl", {xrCompatible: true});

        const vertexShader = this._gl.createShader(this._gl.VERTEX_SHADER);
        this._gl.shaderSource(vertexShader, this._vertexShader);
        this._gl.compileShader(vertexShader);
        if (!this._gl.getShaderParameter(vertexShader, this._gl.COMPILE_STATUS)) {
            console.error(this._gl.getShaderInfoLog(vertexShader));
            throw new Error("Vertex shader was not compiled");
        }

        const fragmentShader = this._gl.createShader(this._gl.FRAGMENT_SHADER);
        this._gl.shaderSource(fragmentShader, this._fragmentShader);
        this._gl.compileShader(fragmentShader);
        if (!this._gl.getShaderParameter(fragmentShader, this._gl.COMPILE_STATUS)) {
            console.error(this._gl.getShaderInfoLog(fragmentShader));
            throw new Error("Fragment shader was not compiled");
        }

        this._program = this._gl.createProgram();
        this._gl.attachShader(this._program, vertexShader);
        this._gl.attachShader(this._program, fragmentShader);
        this._gl.linkProgram(this._program);
        if (!this._gl.getProgramParameter(this._program, this._gl.LINK_STATUS)) {
            console.error(this._gl.getProgramInfoLog(this._program));
            throw new Error("Shaders not linked");
        }

        this._xrSession = await XR.requestSession("immersive-vr");
        this._xrSession.addEventListener("end", () => this.onXrSessionEnd());
        this._xrSession.addEventListener("select", async () => {
            await this.stopVrSession();
        });
        this._glLayer = new XRWebGLLayer(this._xrSession, this._gl);
        this._xrSession.updateRenderState({baseLayer: this._glLayer});
        this._xrReferenceSpace = await this._xrSession.requestReferenceSpace("local");

        this._aVertexPositionLocation = this._gl.getAttribLocation(this._program, "a_VertexPosition");
        this._aTextureCoordinatesLocation = this._gl.getAttribLocation(this._program, "a_TextureCoordinates");

        this._uProjectionMatrixLocation = this._gl.getUniformLocation(this._program, "u_ProjectionMatrix");
        this._uViewMatrixLocation = this._gl.getUniformLocation(this._program, "u_ViewMatrix");
        this._uTextureLocation = this._gl.getUniformLocation(this._program, "u_Texture");

        const squareSize = 5;
        const squareDistance = 10;
        this._vertexBuffer = this._gl.createBuffer();
        this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this._vertexBuffer);
        this._gl.bufferData(this._gl.ARRAY_BUFFER, new Float32Array([
            -squareSize / 2, -squareSize / 2, -squareDistance,
            squareSize / 2, -squareSize / 2, -squareDistance,
            squareSize / 2, squareSize / 2, -squareDistance,
            squareSize / 2, squareSize / 2, -squareDistance,
            -squareSize / 2, squareSize / 2, -squareDistance,
            -squareSize / 2, -squareSize / 2, -squareDistance
        ]), this._gl.STATIC_DRAW);

        this._textureBuffer = this._gl.createBuffer();
        this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this._textureBuffer);
        this._gl.bufferData(
            this._gl.ARRAY_BUFFER,
            new Float32Array([
                0, 0,
                1, 0,
                1, 1,
                1, 1,
                0, 1,
                0, 0,
            ]),
            this._gl.STATIC_DRAW
        );

        const texture = this._gl.createTexture();
        this._gl.bindTexture(this._gl.TEXTURE_2D, texture);
        this._gl.texImage2D(this._gl.TEXTURE_2D, 0, this._gl.RGBA, 1, 1, 0, this._gl.RGBA, this._gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 255, 255]));
        const image = new Image();
        image.src = "./vr-slide.png";
        image.addEventListener("load", () => {
            this._gl.bindTexture(this._gl.TEXTURE_2D, texture);
            this._gl.texImage2D(this._gl.TEXTURE_2D, 0, this._gl.RGBA, this._gl.RGBA, this._gl.UNSIGNED_BYTE, image);
            this._gl.generateMipmap(this._gl.TEXTURE_2D);
        });

        this._xrAnimationFrameRequestID = this._xrSession.requestAnimationFrame((time, xrFrame) =>
            this.onXrAnimationFrame(time, xrFrame)
        );
        this.playAnimation();
    }

    setAnimation(animation) {
        this.stopAnimation();
        this._animation = animation;
        this.playAnimation();
    }

    stopAnimation() {
        if (this._animationAbortController) {
            this._animationAbortController.abort();
            this._animationAbortController = null;
        }
    }

    playAnimation() {
        if (this.running && this._animation) {
            this._animationAbortController = new AbortController();
            this._animation(this._animate.bind(this), this._animationAbortController.signal);
        }
    }

    _animate({timing, duration, onUpdate, abortSignal}) {
        return new Promise(resolve => {
            if (abortSignal?.aborted) {
                resolve();
                return;
            }

            let running = true;

            const abortListener = () => {
                running = false;
                resolve();
            };
            abortSignal?.addEventListener("abort", abortListener);

            const start = performance.now();
            const animateInner = time => {
                if (!running) {
                    return;
                }

                let timeFraction = (time - start) / duration;
                if (timeFraction > 1) {
                    timeFraction = 1;
                }

                onUpdate?.(timing(timeFraction));

                if (timeFraction < 1) {
                    this._xrSession.requestAnimationFrame(animateInner);
                } else {
                    running = false;
                    abortSignal?.removeEventListener("abort", abortListener);
                    resolve();
                }
            };
            this._xrSession.requestAnimationFrame(animateInner);
        });
    }

    onXrAnimationFrame(time, xrFrame) {
        this._xrAnimationFrameRequestID = this._xrSession.requestAnimationFrame((time, xrFrame) =>
            this.onXrAnimationFrame(time, xrFrame)
        );
        this.renderFrame(time, xrFrame);
    }

    async stopVrSession() {
        this.stopAnimation();
        await this._xrSession?.end();
    }

    onXrSessionEnd() {
        this._xrSession.cancelAnimationFrame(this._xrAnimationFrameRequestID);
        this._xrAnimationFrameRequestID = null;
        this._xrSession = null;
    }

    renderFrame(time, xrFrame) {
        const pose = xrFrame.getViewerPose(this._xrReferenceSpace);

        this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, this._glLayer.framebuffer);
        this._gl.clearColor(1.0, 1.0, 1.0, 1.0);
        this._gl.clear(this._gl.COLOR_BUFFER_BIT);

        if (pose.views.length != 2) {
            return;
        }

        this._gl.useProgram(this._program);

        this.renderFrameInView(pose.views[0], this.rotationX * Math.PI / 180, -this.rotationY * Math.PI / 180, 0);
        this.renderFrameInView(pose.views[1], this.rotationX * Math.PI / 180, this.rotationY * Math.PI / 180, 0);
    }

    renderFrameInView(view, rotateX, rotateY, rotateZ) {
        const viewport = this._glLayer.getViewport(view);
        this._gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);

        this._gl.enableVertexAttribArray(this._aVertexPositionLocation);
        this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this._vertexBuffer);
        this._gl.vertexAttribPointer(this._aVertexPositionLocation, 3, this._gl.FLOAT, false, 0, 0);

        this._gl.enableVertexAttribArray(this._aTextureCoordinatesLocation);
        this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this._textureBuffer);
        this._gl.vertexAttribPointer(this._aTextureCoordinatesLocation, 2, this._gl.FLOAT, false, 0, 0);

        this._gl.uniformMatrix4fv(this._uViewMatrixLocation, false, mat4.create());
        let projectionMatrix = mat4.clone(view.projectionMatrix);
        mat4.rotateX(projectionMatrix, projectionMatrix, rotateX);
        mat4.rotateY(projectionMatrix, projectionMatrix, rotateY);
        mat4.rotateZ(projectionMatrix, projectionMatrix, rotateZ);
        this._gl.uniformMatrix4fv(this._uProjectionMatrixLocation, false, projectionMatrix);

        this._gl.uniform1i(this._uTextureLocation, 0);

        this._gl.drawArrays(this._gl.TRIANGLE_STRIP, 0, 6);
    }

    get running() {
        return Boolean(this._xrAnimationFrameRequestID);
    }

    get hasAnimation() {
        return Boolean(this._animation);
    }
}
