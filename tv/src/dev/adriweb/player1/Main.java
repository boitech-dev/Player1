package dev.adriweb.player1;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Base64;
import android.view.Gravity;
import android.view.SurfaceView;
import android.view.View;
import android.view.WindowManager;
import android.webkit.*;
import android.widget.FrameLayout;
import android.widget.Toast;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.Tracks;
import androidx.media3.common.VideoSize;
import androidx.media3.common.text.Cue;
import androidx.media3.common.text.CueGroup;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DecoderCounters;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import io.github.anilbeesetti.nextlib.media3ext.ffdecoder.NextRenderersFactory;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

// The app is the website in a fullscreen WebView (UI updates come from the server), plus:
// - a native player (Media3: hardware video, every audio codec through FFmpeg) drawing UNDER the page. The page stays the
//   interface (controls, menus, subtitles) and drives it through window.P1N; the player reports back through p1n(...).
// - a self-update: on launch, if the server has a newer APK, download it and let Android install it.
public class Main extends Activity {
  static final String SITE = "__SITE__";
  static final int VERSION = __VERSION__;
  WebView w;
  View full; // <video> fullscreen view
  FrameLayout root;
  SurfaceView surf;
  ExoPlayer player;
  final Handler ui = new Handler(Looper.getMainLooper());
  int wantAudio = -1, wantSub = -1; // track choices by order among the file's audio / subtitle tracks, applied once tracks are known
  boolean noAudio; // device test: video only, so speed can be raised (Dolby audio sent to the TV's own processor only plays at 1x)
  boolean testing; long testStart; int stalls; boolean wasReady;

  @Override protected void onCreate(Bundle b) {
    super.onCreate(b);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    root = new FrameLayout(this);
    root.setBackgroundColor(Color.BLACK);
    surf = new SurfaceView(this);
    surf.setVisibility(View.GONE);
    root.addView(surf, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));
    w = new WebView(this);
    w.setBackgroundColor(Color.TRANSPARENT); // the page lets the video show through while the native player plays
    WebSettings s = w.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false); // "send to" must start playback with nobody touching the remote
    s.setUserAgentString(s.getUserAgentString() + " Player1TV");
    CookieManager.getInstance().setAcceptCookie(true);
    w.setWebViewClient(new WebViewClient());
    w.setWebChromeClient(new WebChromeClient() {
      @Override public void onShowCustomView(View v, CustomViewCallback cb) { full = v; ((FrameLayout) getWindow().getDecorView()).addView(v); }
      @Override public void onHideCustomView() { ((FrameLayout) getWindow().getDecorView()).removeView(full); full = null; }
    });
    w.addJavascriptInterface(new Bridge(), "P1N");
    root.addView(w, new FrameLayout.LayoutParams(-1, -1));
    setContentView(root);
    if (b != null) w.restoreState(b); else w.loadUrl(SITE + "/");
    new Thread(this::checkUpdate).start();
  }

  // --- native player ---
  ExoPlayer player() {
    if (player != null) return player;
    String cookie = CookieManager.getInstance().getCookie(SITE); // the file relay sits behind the site's login
    DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory().setUserAgent("Player1TV").setAllowCrossProtocolRedirects(true)
      .setDefaultRequestProperties(cookie == null ? Collections.<String, String>emptyMap() : Collections.singletonMap("Cookie", cookie));
    DefaultRenderersFactory renderers = new NextRenderersFactory(this) // NextLib: Media3's renderers plus FFmpeg
      .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON) // the device's own decoders first, FFmpeg for what it lacks (TrueHD, DTS…)
      .setEnableDecoderFallback(true);
    DefaultLoadControl load = new DefaultLoadControl.Builder().setTargetBufferBytes(96 * 1024 * 1024).setPrioritizeTimeOverSizeThresholds(false).build();
    player = new ExoPlayer.Builder(this, renderers).setMediaSourceFactory(new DefaultMediaSourceFactory(http)).setLoadControl(load).build();
    player.setVideoSurfaceView(surf);
    player.addListener(new Player.Listener() {
      @Override public void onPlaybackStateChanged(int st) {
        if (st == Player.STATE_BUFFERING) { if (wasReady) stalls++; emit("waiting", null); }
        if (st == Player.STATE_READY) { if (!wasReady) { emit("loadeddata", null); testStart = System.currentTimeMillis(); } wasReady = true; if (player.isPlaying()) emit("playing", null); }
        if (st == Player.STATE_ENDED) { if (testing) testDone(); else emit("ended", null); }
        tick();
      }
      @Override public void onIsPlayingChanged(boolean on) { if (on) emit("playing", null); else if (!player.getPlayWhenReady()) emit("pause", null); tick(); } // not playing while buffering is "waiting", not a pause
      @Override public void onPlayerError(PlaybackException e) { if (testing) { testing = false; emit("test", obj("error", e.getErrorCodeName())); } else emit("error", obj("message", e.getErrorCodeName() + ": " + e.getMessage())); }
      @Override public void onTracksChanged(Tracks t) { applyTracks(); }
      @Override public void onVideoSizeChanged(VideoSize v) { fit(v); }
      @Override public void onCues(CueGroup g) { sendCues(g.cues); }
    });
    return player;
  }

  void fit(VideoSize v) { // keep the picture's proportions, centered
    if (v.width == 0 || v.height == 0) return;
    float ar = v.width * v.pixelWidthHeightRatio / v.height, W = root.getWidth(), H = root.getHeight();
    int w2 = (int) (W / H > ar ? H * ar : W), h2 = (int) (W / H > ar ? H : W / ar);
    surf.setLayoutParams(new FrameLayout.LayoutParams(w2, h2, Gravity.CENTER));
  }

  // choose tracks by their order in the file (the page knows the file's tracks from ffprobe, in the same order)
  void applyTracks() {
    if (player == null) return;
    List<Tracks.Group> audio = new ArrayList<>(), text = new ArrayList<>();
    for (Tracks.Group g : player.getCurrentTracks().getGroups()) {
      if (g.getType() == C.TRACK_TYPE_AUDIO) audio.add(g); else if (g.getType() == C.TRACK_TYPE_TEXT) text.add(g);
    }
    androidx.media3.common.TrackSelectionParameters.Builder p = player.getTrackSelectionParameters().buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, noAudio);
    if (wantAudio >= 0 && wantAudio < audio.size()) p.setOverrideForType(new TrackSelectionOverride(audio.get(wantAudio).getMediaTrackGroup(), 0));
    if (wantSub >= 0 && wantSub < text.size()) p.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false).setOverrideForType(new TrackSelectionOverride(text.get(wantSub).getMediaTrackGroup(), 0));
    else p.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true);
    player.setTrackSelectionParameters(p.build());
  }

  // subtitles go to the page, which draws them in its own style; image subtitles (PGS) as pictures with their position
  void sendCues(List<Cue> cues) {
    JSONArray a = new JSONArray();
    try {
      for (Cue c : cues) {
        JSONObject o = new JSONObject();
        if (c.bitmap != null) {
          ByteArrayOutputStream png = new ByteArrayOutputStream(); c.bitmap.compress(Bitmap.CompressFormat.PNG, 100, png);
          o.put("img", "data:image/png;base64," + Base64.encodeToString(png.toByteArray(), Base64.NO_WRAP));
          o.put("x", c.position == Cue.DIMEN_UNSET ? 0.5 : c.position).put("y", c.line == Cue.DIMEN_UNSET ? 0.85 : c.line).put("w", c.size == Cue.DIMEN_UNSET ? 0.5 : c.size);
        } else if (c.text != null) o.put("text", c.text.toString());
        a.put(o);
      }
    } catch (Exception e) { return; }
    emit("cues", obj("cues", a));
  }

  final Runnable ticker = () -> tick();
  void tick() { // time to the page while playing (it drives the progress bar, the resume point, the next-episode card)
    ui.removeCallbacks(ticker);
    if (player == null) return;
    emit("time", obj("t", player.getCurrentPosition() / 1000.0, "d", player.getDuration() == C.TIME_UNSET ? 0 : player.getDuration() / 1000.0));
    if (player.isPlaying()) ui.postDelayed(ticker, 250);
  }

  void testDone() { // what the decoder really did with the clip: frames shown, frames dropped, freezes, time taken
    testing = false;
    DecoderCounters c = player.getVideoDecoderCounters();
    emit("test", obj("rendered", c == null ? 0 : c.renderedOutputBufferCount, "dropped", c == null ? 0 : c.droppedBufferCount + c.skippedOutputBufferCount,
      "stalls", stalls, "ms", System.currentTimeMillis() - testStart, "d", player.getDuration() / 1000.0));
    stopPlayer();
  }

  void stopPlayer() {
    if (player != null) { player.release(); player = null; }
    ui.removeCallbacks(ticker); surf.setVisibility(View.GONE); wasReady = false; stalls = 0;
  }

  void open(String url, double at, float rate) {
    stopPlayer();
    surf.setVisibility(View.VISIBLE);
    ExoPlayer p = player();
    p.setMediaItem(MediaItem.fromUri(url.startsWith("/") ? SITE + url : url), (long) (at * 1000));
    p.setPlaybackSpeed(rate);
    applyTracks(); p.prepare(); p.play();
  }

  void emit(String e, JSONObject data) {
    String js = "window.p1n && p1n(" + JSONObject.quote(e) + "," + (data == null ? "null" : data.toString()) + ")";
    ui.post(() -> w.evaluateJavascript(js, null));
  }
  static JSONObject obj(Object... kv) {
    JSONObject o = new JSONObject();
    try { for (int i = 0; i < kv.length; i += 2) o.put((String) kv[i], kv[i + 1]); } catch (Exception e) {}
    return o;
  }

  // what the page calls (window.P1N); runs on the main thread, and a failure goes back to the page (it falls back) instead of crashing the app
  void safe(Runnable r) { ui.post(() -> { try { r.run(); } catch (Throwable e) { emit(testing ? "test" : "error", obj("message", String.valueOf(e), "error", String.valueOf(e))); testing = false; } }); }
  class Bridge {
    @JavascriptInterface public void load(String url, double at, int audio, int sub) { safe(() -> { wantAudio = audio; wantSub = sub; noAudio = false; testing = false; open(url, at, 1f); }); }
    @JavascriptInterface public void test(String url, float rate) { safe(() -> { wantAudio = -1; wantSub = -1; noAudio = true; open(url, 0, rate); testing = true; }); }
    @JavascriptInterface public void play() { safe(() -> { if (player != null) player.play(); }); }
    @JavascriptInterface public void pause() { safe(() -> { if (player != null) player.pause(); }); }
    @JavascriptInterface public void seek(double t) { safe(() -> { if (player != null) { player.seekTo((long) (t * 1000)); tick(); } }); }
    @JavascriptInterface public void tracks(int audio, int sub) { safe(() -> { wantAudio = audio; wantSub = sub; applyTracks(); }); }
    @JavascriptInterface public void stop() { safe(() -> { testing = false; stopPlayer(); }); }
    @JavascriptInterface public int version() { return VERSION; }
  }

  @Override protected void onStop() { super.onStop(); if (player != null) player.pause(); }
  @Override protected void onDestroy() { stopPlayer(); super.onDestroy(); }

  void checkUpdate() {
    try {
      String body = new String(readAll(new URL(SITE + "/apk-version").openStream()));
      int latest = Integer.parseInt(body.replaceAll("\\D+", ""));
      if (latest <= VERSION) return;
      if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) { // one-time permission
        runOnUiThread(() -> {
          Toast.makeText(this, "Mise à jour disponible : autorise Player1 à installer des applis", Toast.LENGTH_LONG).show();
          startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
        });
        return;
      }
      PackageInstaller pi = getPackageManager().getPackageInstaller();
      int id = pi.createSession(new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL));
      PackageInstaller.Session session = pi.openSession(id);
      try (InputStream in = new URL(SITE + "/player1.apk").openStream(); OutputStream out = session.openWrite("player1.apk", 0, -1)) {
        byte[] buf = new byte[65536]; int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        session.fsync(out);
      }
      String action = getPackageName() + ".INSTALL";
      registerReceiver(new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { // Android asks the user to confirm: show its dialog
          if (i.getIntExtra(PackageInstaller.EXTRA_STATUS, -1) == PackageInstaller.STATUS_PENDING_USER_ACTION)
            startActivity(((Intent) i.getParcelableExtra(Intent.EXTRA_INTENT)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
      }, new IntentFilter(action), Build.VERSION.SDK_INT >= 33 ? Context.RECEIVER_EXPORTED : 0);
      int flags = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
      session.commit(PendingIntent.getBroadcast(this, id, new Intent(action).setPackage(getPackageName()), flags).getIntentSender());
      session.close();
    } catch (Exception e) { /* offline or server down: try again next launch */ }
  }

  static byte[] readAll(InputStream in) throws java.io.IOException {
    ByteArrayOutputStream o = new ByteArrayOutputStream(); byte[] b = new byte[4096]; int n;
    while ((n = in.read(b)) > 0) o.write(b, 0, n); in.close(); return o.toByteArray();
  }

  @Override protected void onSaveInstanceState(Bundle b) { super.onSaveInstanceState(b); w.saveState(b); }
  @Override protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); }
  // Back: let the page close what's open on top (a menu, the player's controls) before going back a page
  @Override public void onBackPressed() {
    if (full != null) { w.getWebChromeClient().onHideCustomView(); return; }
    w.evaluateJavascript("window.p1Back ? p1Back() : false", r -> {
      if ("true".equals(r)) return;
      if (w.canGoBack()) w.goBack(); else finish();
    });
  }
}
