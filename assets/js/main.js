(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Header state + mobile nav ---------- */
  var header = document.querySelector(".header");
  var burger = document.querySelector(".burger");

  function onScroll() {
    if (header) header.classList.toggle("scrolled", window.scrollY > 10);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  if (burger) {
    burger.addEventListener("click", function () {
      var open = document.body.classList.toggle("nav-open");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.querySelectorAll(".nav a").forEach(function (a) {
      a.addEventListener("click", function () {
        document.body.classList.remove("nav-open");
        burger.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* ---------- Reveal on scroll ---------- */
  var revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reduced) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("in"); });
  }

  /* ---------- Counters ---------- */
  var counters = document.querySelectorAll("[data-count]");
  function runCounter(el) {
    var target = parseInt(el.getAttribute("data-count"), 10);
    if (reduced) { el.textContent = target; return; }
    var start = null;
    var dur = 1600;
    function tick(t) {
      if (!start) start = t;
      var p = Math.min((t - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased);
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  if ("IntersectionObserver" in window) {
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { runCounter(e.target); cio.unobserve(e.target); }
      });
    }, { threshold: 0.5 });
    counters.forEach(function (el) { cio.observe(el); });
  } else {
    counters.forEach(runCounter);
  }

  /* ---------- Card spotlight ---------- */
  document.querySelectorAll(".cap").forEach(function (card) {
    card.addEventListener("pointermove", function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty("--mx", (e.clientX - r.left) + "px");
      card.style.setProperty("--my", (e.clientY - r.top) + "px");
    });
  });

  /* ---------- HUD waveform (three-phase) ---------- */
  var wave = document.getElementById("wave");
  if (wave) {
    var paths = wave.querySelectorAll("path");
    var phase = 0;
    function drawWave() {
      var w = 300, h = 90, mid = h / 2;
      paths.forEach(function (p, i) {
        var off = (i * 2 * Math.PI) / 3;
        var d = "";
        for (var x = 0; x <= w; x += 4) {
          var y = mid + Math.sin((x / w) * Math.PI * 4 + phase + off) * (mid - 8);
          d += (x === 0 ? "M" : "L") + x + " " + y.toFixed(1) + " ";
        }
        p.setAttribute("d", d);
      });
      phase += 0.04;
      if (!reduced) requestAnimationFrame(drawWave);
    }
    drawWave();
  }

  /* ---------- Circuit trace canvas ---------- */
  var canvas = document.getElementById("circuit");
  if (canvas && canvas.getContext) {
    var ctx = canvas.getContext("2d");
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W, H, traces = [], pulses = [], G = 32;

    function buildTraces() {
      traces = [];
      var count = Math.round((W * H) / 26000);
      for (var i = 0; i < count; i++) {
        var x = Math.round((Math.random() * W) / G) * G;
        var y = Math.round((Math.random() * H) / G) * G;
        var pts = [[x, y]];
        var dir = Math.floor(Math.random() * 4);
        var segs = 2 + Math.floor(Math.random() * 4);
        for (var s = 0; s < segs; s++) {
          var len = G * (2 + Math.floor(Math.random() * 6));
          // 8 directions: orthogonal + 45° like PCB routing
          var dx = [1, 1, 0, -1, -1, -1, 0, 1][dir];
          var dy = [0, 1, 1, 1, 0, -1, -1, -1][dir];
          x += dx * len; y += dy * len;
          pts.push([x, y]);
          dir = (dir + (Math.random() < 0.5 ? 1 : 7)) % 8;
        }
        traces.push({ pts: pts, len: pathLen(pts) });
      }
    }

    function pathLen(pts) {
      var l = 0;
      for (var i = 1; i < pts.length; i++) {
        l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      }
      return l;
    }

    function pointAt(tr, d) {
      var pts = tr.pts;
      for (var i = 1; i < pts.length; i++) {
        var sl = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        if (d <= sl) {
          var t = d / sl;
          return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
        }
        d -= sl;
      }
      return pts[pts.length - 1];
    }

    function resize() {
      var r = canvas.getBoundingClientRect();
      W = r.width; H = r.height;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildTraces();
      pulses = [];
    }

    function spawn() {
      if (!traces.length) return;
      var tr = traces[Math.floor(Math.random() * traces.length)];
      pulses.push({ tr: tr, d: 0, speed: 1.2 + Math.random() * 2.2, amber: Math.random() < 0.12 });
    }

    function drawStatic() {
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 1;
      traces.forEach(function (tr) {
        ctx.strokeStyle = "rgba(90, 170, 230, 0.13)";
        ctx.beginPath();
        tr.pts.forEach(function (p, i) { i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
        ctx.stroke();
        var a = tr.pts[0], b = tr.pts[tr.pts.length - 1];
        ctx.fillStyle = "rgba(25, 227, 255, 0.35)";
        ctx.fillRect(a[0] - 2, a[1] - 2, 4, 4);
        ctx.strokeStyle = "rgba(25, 227, 255, 0.35)";
        ctx.beginPath(); ctx.arc(b[0], b[1], 3, 0, Math.PI * 2); ctx.stroke();
      });
    }

    function frame() {
      drawStatic();
      if (Math.random() < 0.25 && pulses.length < 40) spawn();
      pulses = pulses.filter(function (p) { return p.d < p.tr.len; });
      pulses.forEach(function (p) {
        p.d += p.speed;
        var col = p.amber ? "255, 176, 32" : "25, 227, 255";
        var tail = 60;
        for (var k = 0; k < tail; k += 3) {
          var pt = pointAt(p.tr, Math.max(0, p.d - k));
          ctx.fillStyle = "rgba(" + col + "," + (0.9 * (1 - k / tail)).toFixed(2) + ")";
          ctx.fillRect(pt[0] - 1, pt[1] - 1, 2, 2);
        }
        var head = pointAt(p.tr, p.d);
        ctx.shadowColor = "rgba(" + col + ",1)";
        ctx.shadowBlur = 12;
        ctx.fillStyle = "rgba(" + col + ",1)";
        ctx.beginPath(); ctx.arc(head[0], head[1], 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      });
      if (running) requestAnimationFrame(frame);
    }

    var running = false;
    resize();
    var rt;
    window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(resize, 150); });

    if (reduced) {
      drawStatic();
    } else if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        var vis = entries[0].isIntersecting;
        if (vis && !running) { running = true; requestAnimationFrame(frame); }
        else if (!vis) { running = false; }
      }).observe(canvas);
    } else {
      running = true; requestAnimationFrame(frame);
    }
  }

  /* ---------- Quote form → email ---------- */
  var form = document.getElementById("quote-form");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var f = new FormData(form);
      var lines = [
        "Name: " + (f.get("name") || ""),
        "Company: " + (f.get("company") || ""),
        "Phone: " + (f.get("phone") || ""),
        "Email: " + (f.get("email") || ""),
        "Service: " + (f.get("service") || ""),
        "",
        f.get("message") || ""
      ];
      var subject = "Quote request — " + (f.get("service") || "General") + " — " + (f.get("company") || f.get("name") || "");
      window.location.href = "mailto:service@wyelec.com.au?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(lines.join("\n"));
      var status = document.getElementById("form-status");
      if (status) status.textContent = "> Opening your email client… or call 02 6884 9292.";
    });
  }

  /* ---------- Year ---------- */
  document.querySelectorAll("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });
})();
