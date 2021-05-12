function animate({timing, duration, onStart, onUpdate, onEnd}) {
    onStart?.();

    const handler = {
        _running: true,
        stop() {
            this._running = false;
        },
        get running() {
            return this._running;
        }
    }

    const start = performance.now();
    requestAnimationFrame(function animateInner(time) {
        if (!handler.running) {
            return;
        }

        let timeFraction = (time - start) / duration;
        if (timeFraction > 1) {
            timeFraction = 1;
        }

        onUpdate?.(timing(timeFraction));

        if (timeFraction < 1) {
            requestAnimationFrame(animateInner);
        } else {
            handler.stop();
            onEnd?.();
        }
    });
    return handler;
}

const linear = x => x;

const easeInOutSine = x => -(Math.cos(Math.PI * x) - 1) / 2;