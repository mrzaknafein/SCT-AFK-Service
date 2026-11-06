using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Media;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using System.Windows.Threading;
using WinForms = System.Windows.Forms;
using Drawing = System.Drawing;

[assembly: AssemblyTitle("SCT AFK Service")]
[assembly: AssemblyDescription("SCT AFK Service - Native WPF Multi-Account & Automation Control Panel")]
[assembly: AssemblyCompany("SCT AFK Service")]
[assembly: AssemblyProduct("SCT AFK Service")]
[assembly: AssemblyVersion("2.4.0.0")]
[assembly: AssemblyFileVersion("2.4.0.0")]

namespace SctAfkService
{
    public static class JsonHelper
    {
        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

        public static string Serialize(object obj)
        {
            try { return Serializer.Serialize(obj); }
            catch { return "{}"; }
        }

        public static Dictionary<string, object> DeserializeDict(string json)
        {
            if (string.IsNullOrEmpty(json)) return new Dictionary<string, object>();
            try
            {
                object raw = Serializer.DeserializeObject(json);
                return Dict(raw);
            }
            catch
            {
                return new Dictionary<string, object>();
            }
        }

        public static Dictionary<string, object> Dict(object obj)
        {
            if (obj is Dictionary<string, object>) return (Dictionary<string, object>)obj;
            return new Dictionary<string, object>();
        }

        public static Dictionary<string, object> SubDict(object obj, string key)
        {
            Dictionary<string, object> d = Dict(obj);
            object val;
            if (d.TryGetValue(key, out val) && val is Dictionary<string, object>)
                return (Dictionary<string, object>)val;
            return new Dictionary<string, object>();
        }

        public static List<object> Arr(object obj, string key)
        {
            Dictionary<string, object> d = Dict(obj);
            object val;
            if (d.TryGetValue(key, out val))
                return ToList(val);
            return new List<object>();
        }

        public static List<object> ToList(object val)
        {
            List<object> list = new List<object>();
            if (val is object[])
            {
                object[] arr = (object[])val;
                for (int i = 0; i < arr.Length; i++) list.Add(arr[i]);
            }
            else if (val is ArrayList)
            {
                ArrayList al = (ArrayList)val;
                for (int i = 0; i < al.Count; i++) list.Add(al[i]);
            }
            else if (val is IEnumerable && !(val is string) && !(val is IDictionary))
            {
                foreach (object item in (IEnumerable)val) list.Add(item);
            }
            return list;
        }

        public static string Str(object obj, string key, string def)
        {
            Dictionary<string, object> d = Dict(obj);
            object val;
            if (d.TryGetValue(key, out val) && val != null)
            {
                if (val is bool) return ((bool)val) ? "true" : "";
                return val.ToString();
            }
            return def;
        }

        public static int Int(object obj, string key, int def)
        {
            Dictionary<string, object> d = Dict(obj);
            object val;
            if (d.TryGetValue(key, out val) && val != null)
            {
                if (val is int) return (int)val;
                if (val is long) return (int)(long)val;
                if (val is double) return (int)Math.Round((double)val);
                if (val is decimal) return (int)Math.Round((decimal)val);
                int parsed;
                if (int.TryParse(val.ToString(), out parsed)) return parsed;
            }
            return def;
        }

        public static long Long(object obj, string key, long def)
        {
            Dictionary<string, object> d = Dict(obj);
            object val;
            if (d.TryGetValue(key, out val) && val != null)
            {
                if (val is long) return (long)val;
                if (val is int) return (long)(int)val;
                if (val is double) return (long)Math.Round((double)val);
                if (val is decimal) return (long)Math.Round((decimal)val);
                long parsed;
                if (long.TryParse(val.ToString(), out parsed)) return parsed;
            }
            return def;
        }

        public static double Dbl(object obj, string key, double def)
        {
            Dictionary<string, object> d = Dict(obj);
            object val;
            if (d.TryGetValue(key, out val) && val != null)
            {
                if (val is double) return (double)val;
                if (val is int) return (double)(int)val;
                if (val is long) return (double)(long)val;
                if (val is decimal) return (double)(decimal)val;
                double parsed;
                if (double.TryParse(val.ToString(), System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out parsed))
                    return parsed;
            }
            return def;
        }

        public static bool Bool(object obj, string key, bool def)
        {
            Dictionary<string, object> d = Dict(obj);
            object val;
            if (d.TryGetValue(key, out val) && val != null)
            {
                if (val is bool) return (bool)val;
                string s = val.ToString().Trim().ToLowerInvariant();
                if (s == "true" || s == "1") return true;
                if (s == "false" || s == "0") return false;
            }
            return def;
        }

        public static string CleanMinecraftCodes(string input)
        {
            if (string.IsNullOrEmpty(input)) return "";
            string s = Regex.Replace(input, @"[\uE000-\uF8FF]", "");
            s = Regex.Replace(s, @"§x(§[0-9a-fA-F]){6}", "", RegexOptions.IgnoreCase);
            s = Regex.Replace(s, @"[§&][0-9a-fk-or]", "", RegexOptions.IgnoreCase);
            s = Regex.Replace(s, @"&#[0-9a-fA-F]{6}", "", RegexOptions.IgnoreCase);
            return s.Trim();
        }
    }

    // =========================================================================
    // NATIVE AUDIO SYNTHESIZER (RIFF/WAV PCM In-Memory Generator)
    // =========================================================================
    public static class SctSoundSynthesizer
    {
        private class ToneStep
        {
            public double Frequency;
            public double StartSec;
            public double DurationSec;
            public string WaveType;
            public double AttackSec;
            public double Gain;
        }

        public static void PlayAlertSound(string alertType, string theme, int volumePercent)
        {
            if (volumePercent <= 0) return;
            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    byte[] wavBytes = SynthesizeWav(alertType ?? "notify", theme ?? "cyber", volumePercent);
                    if (wavBytes == null || wavBytes.Length == 0) return;
                    using (MemoryStream ms = new MemoryStream(wavBytes))
                    using (SoundPlayer sp = new SoundPlayer(ms))
                    {
                        sp.PlaySync();
                    }
                }
                catch { }
            });
        }

        public static byte[] SynthesizeWav(string alertType, string theme, int volumePercent)
        {
            int clampedVol = Math.Max(0, Math.Min(100, volumePercent));
            double baseGain = Math.Max(0.01, Math.Min(0.75, (clampedVol / 100.0) * 0.45));
            string t = (theme ?? "cyber").ToLowerInvariant();
            string type = (alertType ?? "notify").ToLowerInvariant();

            double[] notes;
            string wave = "square";
            double stepGap = 0.08;
            double dur = 0.08;
            double attack = 0.006;
            double gainMult = 1.0;

            if (t == "chime")
            {
                wave = "sine";
                attack = 0.02;
                if (type == "damage") { notes = new double[] { 440, 415, 370 }; stepGap = 0.14; dur = 0.22; }
                else if (type == "disconnect") { notes = new double[] { 494, 370 }; stepGap = 0.16; dur = 0.24; }
                else if (type == "captcha") { notes = new double[] { 523, 659, 784, 1046 }; stepGap = 0.11; dur = 0.22; }
                else if (type == "mention") { notes = new double[] { 659, 784 }; stepGap = 0.14; dur = 0.24; }
                else { notes = new double[] { 523, 659 }; stepGap = 0.12; dur = 0.22; }
            }
            else if (t == "arcade")
            {
                wave = "square";
                attack = 0.004;
                gainMult = 0.85;
                if (type == "damage") { notes = new double[] { 240, 160, 90 }; stepGap = 0.055; dur = 0.05; }
                else if (type == "disconnect") { notes = new double[] { 440, 330, 220, 146 }; stepGap = 0.07; dur = 0.06; }
                else if (type == "captcha") { notes = new double[] { 659, 987, 1318 }; stepGap = 0.065; dur = 0.055; }
                else if (type == "mention") { notes = new double[] { 784, 1046 }; stepGap = 0.06; dur = 0.05; }
                else { notes = new double[] { 587, 880 }; stepGap = 0.065; dur = 0.055; }
            }
            else if (t == "radar")
            {
                wave = "sine";
                attack = 0.008;
                if (type == "damage") { notes = new double[] { 980, 660, 980 }; stepGap = 0.10; dur = 0.12; }
                else if (type == "disconnect") { notes = new double[] { 880, 330 }; stepGap = 0.15; dur = 0.18; }
                else if (type == "captcha") { notes = new double[] { 1174, 1396, 1760 }; stepGap = 0.08; dur = 0.11; }
                else if (type == "mention") { notes = new double[] { 1318, 1760 }; stepGap = 0.09; dur = 0.13; }
                else { notes = new double[] { 1318 }; stepGap = 0.10; dur = 0.22; }
            }
            else if (t == "subtle")
            {
                wave = "triangle";
                attack = 0.012;
                gainMult = 1.15;
                if (type == "damage") { notes = new double[] { 180, 120 }; stepGap = 0.08; dur = 0.09; }
                else if (type == "disconnect") { notes = new double[] { 220, 130 }; stepGap = 0.10; dur = 0.11; }
                else if (type == "captcha") { notes = new double[] { 330, 440, 550 }; stepGap = 0.07; dur = 0.08; }
                else if (type == "mention") { notes = new double[] { 260, 350 }; stepGap = 0.08; dur = 0.09; }
                else { notes = new double[] { 290 }; stepGap = 0.09; dur = 0.10; }
            }
            else
            {
                // cyber (default)
                if (type == "damage") { notes = new double[] { 580, 380, 240 }; wave = "sawtooth"; stepGap = 0.09; dur = 0.08; gainMult = 0.9; attack = 0.006; }
                else if (type == "disconnect") { notes = new double[] { 340, 200 }; wave = "sawtooth"; stepGap = 0.14; dur = 0.12; gainMult = 0.9; attack = 0.008; }
                else if (type == "captcha") { notes = new double[] { 523, 659, 784, 1046 }; wave = "square"; stepGap = 0.07; dur = 0.06; gainMult = 0.8; attack = 0.005; }
                else if (type == "mention") { notes = new double[] { 660, 880 }; wave = "square"; stepGap = 0.09; dur = 0.08; gainMult = 0.8; attack = 0.005; }
                else { notes = new double[] { 587, 880 }; wave = "square"; stepGap = 0.08; dur = 0.07; gainMult = 0.8; attack = 0.005; }
            }

            List<ToneStep> steps = new List<ToneStep>();
            double totalDuration = 0.05;
            for (int i = 0; i < notes.Length; i++)
            {
                double st = i * stepGap;
                double end = st + dur;
                if (end + 0.04 > totalDuration) totalDuration = end + 0.04;
                steps.Add(new ToneStep
                {
                    Frequency = notes[i],
                    StartSec = st,
                    DurationSec = dur,
                    WaveType = wave,
                    AttackSec = attack,
                    Gain = baseGain * gainMult
                });
            }

            int sampleRate = 44100;
            int numSamples = (int)(totalDuration * sampleRate);
            short[] pcm = new short[numSamples];

            for (int s = 0; s < numSamples; s++)
            {
                double time = (double)s / sampleRate;
                double sampleVal = 0.0;

                for (int i = 0; i < steps.Count; i++)
                {
                    ToneStep ts = steps[i];
                    if (time >= ts.StartSec && time <= ts.StartSec + ts.DurationSec)
                    {
                        double localT = time - ts.StartSec;
                        double env;
                        if (localT < ts.AttackSec)
                            env = (localT / Math.Max(0.001, ts.AttackSec)) * ts.Gain;
                        else
                        {
                            double decayProgress = (localT - ts.AttackSec) / Math.Max(0.001, ts.DurationSec - ts.AttackSec);
                            env = ts.Gain * Math.Pow(0.001, decayProgress);
                        }

                        double phase = (localT * ts.Frequency) % 1.0;
                        double osc = 0.0;
                        if (ts.WaveType == "sine")
                            osc = Math.Sin(2.0 * Math.PI * phase);
                        else if (ts.WaveType == "square")
                            osc = phase < 0.5 ? 1.0 : -1.0;
                        else if (ts.WaveType == "sawtooth")
                            osc = 2.0 * phase - 1.0;
                        else if (ts.WaveType == "triangle")
                            osc = 1.0 - 4.0 * Math.Abs(Math.Round(phase - 0.25) - (phase - 0.25));

                        sampleVal += osc * env;
                    }
                }

                if (sampleVal > 0.98) sampleVal = 0.98;
                if (sampleVal < -0.98) sampleVal = -0.98;
                pcm[s] = (short)(sampleVal * 32760);
            }

            using (MemoryStream ms = new MemoryStream())
            using (BinaryWriter bw = new BinaryWriter(ms))
            {
                int dataByteCount = numSamples * 2;
                bw.Write(Encoding.ASCII.GetBytes("RIFF"));
                bw.Write(36 + dataByteCount);
                bw.Write(Encoding.ASCII.GetBytes("WAVE"));
                bw.Write(Encoding.ASCII.GetBytes("fmt "));
                bw.Write(16);
                bw.Write((short)1); // PCM
                bw.Write((short)1); // Mono
                bw.Write(sampleRate);
                bw.Write(sampleRate * 2);
                bw.Write((short)2);
                bw.Write((short)16);
                bw.Write(Encoding.ASCII.GetBytes("data"));
                bw.Write(dataByteCount);
                for (int i = 0; i < numSamples; i++)
                {
                    bw.Write(pcm[i]);
                }
                bw.Flush();
                return ms.ToArray();
            }
        }
    }

    // =========================================================================
    // NAMED PIPE IPC CLIENT (\\.\pipe\SctAfkEngineIpc)
    // =========================================================================
    public class SctPipeClient
    {
        public const string PIPE_NAME = "SctAfkEngineIpc";
        private NamedPipeClientStream pipeStream;
        private StreamWriter pipeWriter;
        private Thread readerThread;
        private readonly object writeLock = new object();
        private readonly Dictionary<string, Action<int, Dictionary<string, object>>> pendingCallbacks =
            new Dictionary<string, Action<int, Dictionary<string, object>>>();
        private volatile bool isRunning = false;
        private volatile bool isConnected = false;
        private int reqCounter = 0;
        private readonly Dispatcher uiDispatcher;

        public event Action<bool> OnConnectionChanged;
        public event Action<string, Dictionary<string, object>> OnServerEvent;

        public bool IsConnected { get { return isConnected; } }

        public SctPipeClient(Dispatcher dispatcher)
        {
            uiDispatcher = dispatcher;
        }

        public static bool IsEnginePipeReady()
        {
            try
            {
                using (NamedPipeClientStream testPipe = new NamedPipeClientStream(".", PIPE_NAME, PipeDirection.InOut, PipeOptions.Asynchronous))
                {
                    testPipe.Connect(450);
                    return testPipe.IsConnected;
                }
            }
            catch
            {
                return false;
            }
        }

        public static bool WaitForEnginePipeReady(int maxWaitMs)
        {
            Stopwatch sw = Stopwatch.StartNew();
            while (sw.ElapsedMilliseconds < maxWaitMs)
            {
                if (IsEnginePipeReady()) return true;
                Thread.Sleep(250);
            }
            return false;
        }

        public static Dictionary<string, object> SendOneShotRequest(string method, string url, object body, int timeoutMs)
        {
            try
            {
                using (NamedPipeClientStream client = new NamedPipeClientStream(".", PIPE_NAME, PipeDirection.InOut, PipeOptions.None))
                {
                    client.Connect(timeoutMs);
                    string reqId = Guid.NewGuid().ToString("N");
                    Dictionary<string, object> packet = new Dictionary<string, object>();
                    packet["type"] = "req";
                    packet["id"] = reqId;
                    packet["method"] = method;
                    packet["url"] = url;
                    packet["body"] = body;

                    byte[] payload = Encoding.UTF8.GetBytes(JsonHelper.Serialize(packet) + "\n");
                    client.Write(payload, 0, payload.Length);
                    client.Flush();

                    using (StreamReader sr = new StreamReader(client, Encoding.UTF8))
                    {
                        Stopwatch sw = Stopwatch.StartNew();
                        while (sw.ElapsedMilliseconds < timeoutMs)
                        {
                            string line = sr.ReadLine();
                            if (line == null) break;
                            Dictionary<string, object> msg = JsonHelper.DeserializeDict(line);
                            if (JsonHelper.Str(msg, "type", "") == "res" && JsonHelper.Str(msg, "id", "") == reqId)
                            {
                                return JsonHelper.SubDict(msg, "data");
                            }
                        }
                    }
                }
            }
            catch { }
            return null;
        }

        public static bool CheckEngineMatchingBuild(string expectedBuildId)
        {
            try
            {
                Dictionary<string, object> data = SendOneShotRequest("GET", "/api/keyauth/status", null, 1200);
                if (data == null || data.Count == 0) return false;
                string runningBuild = JsonHelper.Str(data, "engineBuildId", "");
                if (string.IsNullOrEmpty(runningBuild)) runningBuild = JsonHelper.Str(data, "buildId", "");
                if (string.IsNullOrEmpty(expectedBuildId)) return !string.IsNullOrEmpty(runningBuild);
                if (string.Equals(runningBuild, expectedBuildId, StringComparison.OrdinalIgnoreCase)) return true;
                if (!string.IsNullOrEmpty(runningBuild) && !Program.IsBuildIdNewer(expectedBuildId, runningBuild)) return true;
                return false;
            }
            catch
            {
                return false;
            }
        }

        public static void RequestPipeShutdown()
        {
            try
            {
                SendOneShotRequest("POST", "/api/shutdown", new Dictionary<string, object>(), 800);
            }
            catch { }
        }

        public void Start()
        {
            if (isRunning) return;
            isRunning = true;
            readerThread = new Thread(PipeLoop);
            readerThread.IsBackground = true;
            readerThread.Name = "SctPipeClientLoop";
            readerThread.Start();
        }

        public void Stop()
        {
            isRunning = false;
            CloseCurrentPipe();
        }

        private void CloseCurrentPipe()
        {
            lock (writeLock)
            {
                try { if (pipeWriter != null) pipeWriter.Dispose(); } catch { }
                try { if (pipeStream != null) pipeStream.Dispose(); } catch { }
                pipeWriter = null;
                pipeStream = null;
            }
        }

        private void SetConnectedState(bool state)
        {
            if (isConnected == state) return;
            isConnected = state;
            Action<bool> handler = OnConnectionChanged;
            if (handler != null && uiDispatcher != null)
            {
                uiDispatcher.BeginInvoke(new Action(delegate { handler(state); }));
            }
        }

        private void PipeLoop()
        {
            while (isRunning)
            {
                try
                {
                    NamedPipeClientStream stream = new NamedPipeClientStream(".", PIPE_NAME, PipeDirection.InOut, PipeOptions.Asynchronous);
                    stream.Connect(1500);

                    lock (writeLock)
                    {
                        pipeStream = stream;
                        pipeWriter = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true };
                    }

                    SetConnectedState(true);

                    using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                    {
                        while (isRunning && stream.IsConnected)
                        {
                            string line = reader.ReadLine();
                            if (line == null) break;
                            if (string.IsNullOrWhiteSpace(line)) continue;
                            ProcessIncomingLine(line);
                        }
                    }
                }
                catch
                {
                }

                SetConnectedState(false);
                CloseCurrentPipe();

                if (isRunning)
                {
                    Thread.Sleep(650);
                }
            }
        }

        private void ProcessIncomingLine(string line)
        {
            Dictionary<string, object> packet = JsonHelper.DeserializeDict(line);
            if (packet.Count == 0) return;

            string msgType = JsonHelper.Str(packet, "type", "");
            if (msgType == "res")
            {
                string reqId = JsonHelper.Str(packet, "id", "");
                int status = JsonHelper.Int(packet, "status", 200);
                Dictionary<string, object> data = JsonHelper.SubDict(packet, "data");
                if (data.Count == 0 && packet.ContainsKey("data") && !(packet["data"] is Dictionary<string, object>))
                {
                    data = new Dictionary<string, object>();
                    data["value"] = packet["data"];
                }

                Action<int, Dictionary<string, object>> cb = null;
                lock (pendingCallbacks)
                {
                    if (pendingCallbacks.TryGetValue(reqId, out cb))
                    {
                        pendingCallbacks.Remove(reqId);
                    }
                }

                if (cb != null && uiDispatcher != null)
                {
                    uiDispatcher.BeginInvoke(new Action(delegate
                    {
                        try { cb(status, data); } catch { }
                    }));
                }
            }
            else if (msgType == "event")
            {
                string evName = JsonHelper.Str(packet, "event", "");
                Dictionary<string, object> evData = JsonHelper.SubDict(packet, "data");
                DispatchEventToUi(evName, evData);
            }
            else if (!string.IsNullOrEmpty(msgType))
            {
                // Fallback if event packet uses type directly
                Dictionary<string, object> evData = JsonHelper.SubDict(packet, "data");
                DispatchEventToUi(msgType, evData);
            }
        }

        private void DispatchEventToUi(string evName, Dictionary<string, object> evData)
        {
            Action<string, Dictionary<string, object>> handler = OnServerEvent;
            if (handler != null && uiDispatcher != null)
            {
                uiDispatcher.BeginInvoke(new Action(delegate
                {
                    try { handler(evName, evData); } catch { }
                }));
            }
        }

        public void SendApiAsync(string method, string url, object body, Action<int, Dictionary<string, object>> callback = null)
        {
            string reqId = Interlocked.Increment(ref reqCounter).ToString() + "_" + Guid.NewGuid().ToString("N").Substring(0, 6);

            ThreadPool.QueueUserWorkItem(delegate
            {
                int respStatus = 503;
                Dictionary<string, object> respData = new Dictionary<string, object>();
                try
                {
                    Dictionary<string, object> reqPacket = new Dictionary<string, object>();
                    reqPacket["type"] = "req";
                    reqPacket["id"] = reqId;
                    reqPacket["method"] = string.IsNullOrEmpty(method) ? "GET" : method.ToUpperInvariant();
                    reqPacket["url"] = url;
                    reqPacket["body"] = body;

                    byte[] payload = Encoding.UTF8.GetBytes(JsonHelper.Serialize(reqPacket) + "\n");
                    bool completed = false;

                    for (int attempt = 0; attempt < 2 && !completed; attempt++)
                    {
                        try
                        {
                            using (NamedPipeClientStream client = new NamedPipeClientStream(".", PIPE_NAME, PipeDirection.InOut, PipeOptions.None))
                            {
                                client.Connect(attempt == 0 ? 2500 : 3500);
                                client.Write(payload, 0, payload.Length);
                                client.Flush();

                                using (StreamReader sr = new StreamReader(client, Encoding.UTF8))
                                {
                                    Stopwatch sw = Stopwatch.StartNew();
                                    while (sw.ElapsedMilliseconds < 12000)
                                    {
                                        string line = sr.ReadLine();
                                        if (line == null) break;
                                        if (string.IsNullOrWhiteSpace(line)) continue;
                                        Dictionary<string, object> msg = JsonHelper.DeserializeDict(line);
                                        if (JsonHelper.Str(msg, "type", "") == "res" && JsonHelper.Str(msg, "id", "") == reqId)
                                        {
                                            respStatus = JsonHelper.Int(msg, "status", 200);
                                            respData = JsonHelper.SubDict(msg, "data");
                                            if (respData.Count == 0 && msg.ContainsKey("data") && !(msg["data"] is Dictionary<string, object>))
                                            {
                                                respData = new Dictionary<string, object>();
                                                respData["value"] = msg["data"];
                                            }
                                            completed = true;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                        catch
                        {
                            if (attempt == 0) Thread.Sleep(350);
                        }
                    }

                    if (!completed)
                    {
                        respStatus = 503;
                        respData["error"] = "Yerel motor bağlantısı bekleniyor...";
                    }
                }
                catch (Exception ex)
                {
                    respStatus = 500;
                    respData["error"] = ex.Message;
                }

                if (callback != null && uiDispatcher != null)
                {
                    uiDispatcher.BeginInvoke(new Action(delegate
                    {
                        try { callback(respStatus, respData); } catch { }
                    }));
                }
            });
        }
    }

    // =========================================================================
    // EDITORIAL WARM SAND-BEIGE, FOREST GREEN & ELECTRIC PURPLE WPF UI THEME
    // Palette: Sand Beige (#E8DCC4 / #F3ECE0) + Forest Green (#1F3D2B) + Electric Purple (#8B5CF6)
    // =========================================================================
    
    // =========================================================================
    // MINECRAFT RETRO TEXTURE & SKIN AVATAR LOADER (PIXEL-PERFECT)
    // =========================================================================
    public static class McTextureHelper
    {
      private static readonly Dictionary<string, ImageSource> avatarCache = new Dictionary<string, ImageSource>(StringComparer.OrdinalIgnoreCase);
      private static readonly Dictionary<string, ImageSource> textureCache = new Dictionary<string, ImageSource>(StringComparer.OrdinalIgnoreCase);

      private static readonly HashSet<string> KnownBlockNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
      {
        "tripwire_hook", "lever", "stone_button", "oak_button", "repeater", "comparator",
        "redstone_wire", "redstone_torch", "hopper", "dropper", "dispenser", "observer",
        "piston", "sticky_piston", "chest", "trapped_chest", "ender_chest", "barrel",
        "furnace", "blast_furnace", "smoker", "crafting_table", "loom", "cartography_table",
        "fletching_table", "smithing_table", "grindstone", "anvil", "chipped_anvil", "damaged_anvil",
        "enchanting_table", "brewing_stand", "cauldron", "beacon", "conduit", "lodestone",
        "tnt", "sponge", "wet_sponge", "spawner", "cobweb", "hay_block", "target",
        "honeycomb_block", "slime_block", "honey_block", "sea_lantern", "glowstone", "shroomlight",
        "lantern", "soul_lantern", "torch", "soul_torch", "bell", "campfire", "soul_campfire"
      };

      public static string GetItemTextureUrl(string rawName, bool forceBlock = false)
      {
        if (string.IsNullOrEmpty(rawName)) return "";
        string clean = rawName.Trim().ToLowerInvariant().Replace("minecraft:", "");
        if (clean == "air" || clean == "hava" || clean == "bos" || clean == "boş") return "";

        // Common Minecraft name normalization
        if (clean == "steak") clean = "cooked_beef";

        bool isBlock = forceBlock || KnownBlockNames.Contains(clean) ||
                       clean.EndsWith("_block") || clean.EndsWith("_ore") ||
                       clean.EndsWith("_stairs") || clean.EndsWith("_slab") ||
                       clean.EndsWith("_planks") || clean.EndsWith("_wool") ||
                       clean.EndsWith("_terracotta") || clean.EndsWith("_concrete") ||
                       clean.EndsWith("_carpet") || clean.EndsWith("_log") ||
                       clean.EndsWith("_wood") || clean.EndsWith("_stem") ||
                       clean.EndsWith("_glass") || clean.EndsWith("_pane") ||
                       clean.EndsWith("_shulker_box") || clean.EndsWith("_bed");

        string folder = isBlock ? "block" : "item";
        return string.Format("https://assets.mcasset.cloud/1.20.4/assets/minecraft/textures/{0}/{1}.png", folder, clean);
      }

      public static ImageSource GetTextureSource(string rawName)
      {
        if (string.IsNullOrEmpty(rawName)) return null;
        string clean = rawName.Trim().ToLowerInvariant().Replace("minecraft:", "");
        lock (textureCache)
        {
          if (textureCache.ContainsKey(clean)) return textureCache[clean];
        }

        try
        {
          string url = GetItemTextureUrl(clean, false);
          if (string.IsNullOrEmpty(url)) return null;

          BitmapImage bmp = new BitmapImage();
          bmp.BeginInit();
          bmp.UriSource = new Uri(url, UriKind.Absolute);
          bmp.CacheOption = BitmapCacheOption.OnLoad;
          bmp.CreateOptions = BitmapCreateOptions.IgnoreColorProfile;
          bmp.EndInit();

          RenderOptions.SetBitmapScalingMode(bmp, BitmapScalingMode.NearestNeighbor);

          lock (textureCache)
          {
            textureCache[clean] = bmp;
          }
          return bmp;
        }
        catch
        {
          return null;
        }
      }

      public static FrameworkElement CreateItemIcon(string rawName, int size = 32)
      {
        if (string.IsNullOrEmpty(rawName)) return new Grid { Width = size, Height = size };
        string clean = rawName.Trim().ToLowerInvariant().Replace("minecraft:", "");

        Image img = new Image
        {
          Width = size,
          Height = size,
          Stretch = Stretch.Uniform,
          HorizontalAlignment = HorizontalAlignment.Center,
          VerticalAlignment = VerticalAlignment.Center
        };
        RenderOptions.SetBitmapScalingMode(img, BitmapScalingMode.NearestNeighbor);

        try
        {
          string url = GetItemTextureUrl(clean, false);
          if (!string.IsNullOrEmpty(url))
          {
            BitmapImage bmp = new BitmapImage();
            bmp.BeginInit();
            bmp.UriSource = new Uri(url, UriKind.Absolute);
            bmp.CacheOption = BitmapCacheOption.OnLoad;
            bmp.CreateOptions = BitmapCreateOptions.IgnoreColorProfile;
            bmp.EndInit();

            bmp.DownloadFailed += delegate
            {
              // If item failed, attempt fallback to block folder
              try
              {
                string fbUrl = GetItemTextureUrl(clean, true);
                BitmapImage fbBmp = new BitmapImage(new Uri(fbUrl, UriKind.Absolute));
                RenderOptions.SetBitmapScalingMode(fbBmp, BitmapScalingMode.NearestNeighbor);
                img.Source = fbBmp;
              }
              catch {}
            };

            img.Source = bmp;
          }
        }
        catch {}

        return img;
      }

      public static ImageSource GetAvatarSource(string username, int size = 32)
      {
        if (string.IsNullOrEmpty(username)) username = "Steve";
        string key = username + "_" + size;
        lock (avatarCache)
        {
          if (avatarCache.ContainsKey(key)) return avatarCache[key];
        }

        try
        {
          string url = string.Format("https://mc-heads.net/avatar/{0}/{1}", Uri.EscapeDataString(username), size);
          BitmapImage bmp = new BitmapImage();
          bmp.BeginInit();
          bmp.UriSource = new Uri(url, UriKind.Absolute);
          bmp.CacheOption = BitmapCacheOption.OnLoad;
          bmp.CreateOptions = BitmapCreateOptions.IgnoreColorProfile;
          bmp.EndInit();

          RenderOptions.SetBitmapScalingMode(bmp, BitmapScalingMode.NearestNeighbor);

          lock (avatarCache)
          {
            avatarCache[key] = bmp;
          }
          return bmp;
        }
        catch
        {
          return null;
        }
      }

      public static FrameworkElement CreateSkinAvatar(string username, int size = 32)
      {
        Border container = new Border
        {
          Width = size,
          Height = size,
          CornerRadius = new CornerRadius(Math.Max(4, size / 6)),
          Background = UiTheme.SandBeige,
          BorderBrush = UiTheme.BorderBrush,
          BorderThickness = new Thickness(1),
          ClipToBounds = true
        };

        try
        {
          Image img = new Image
          {
            Width = size,
            Height = size,
            Stretch = Stretch.UniformToFill
          };
          RenderOptions.SetBitmapScalingMode(img, BitmapScalingMode.NearestNeighbor);

          ImageSource src = GetAvatarSource(username, size);
          if (src != null)
          {
            img.Source = src;
            container.Child = img;
          }
        }
        catch {}

        return container;
      }

      public static FrameworkElement CreateSkinAvatarBadge(string username, int size = 30, Brush statusBrush = null)
      {
        Grid grid = new Grid { Width = size + 4, Height = size + 4 };

        FrameworkElement av = CreateSkinAvatar(username, size);
        av.HorizontalAlignment = HorizontalAlignment.Left;
        av.VerticalAlignment = VerticalAlignment.Top;
        grid.Children.Add(av);

        if (statusBrush != null)
        {
          Border dot = new Border
          {
            Width = 9,
            Height = 9,
            CornerRadius = new CornerRadius(4.5),
            Background = statusBrush,
            BorderBrush = UiTheme.BgCard,
            BorderThickness = new Thickness(1.5),
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Bottom
          };
          grid.Children.Add(dot);
        }

        return grid;
      }
    }

    public static class UiTheme
    {
        // Warm Sand-Beige & Ivory Surfaces (Editorial 60% Canvas & Cards)
        public static readonly SolidColorBrush BgBase = BrushHex("#F2EAE0");
        public static readonly SolidColorBrush BgSidebar = BrushHex("#FAF6EE");
        public static readonly SolidColorBrush BgCard = BrushHex("#FFFDF9");
        public static readonly SolidColorBrush BgCardHover = BrushHex("#EFE5D4");
        public static readonly SolidColorBrush BgInput = BrushHex("#F5EFE4");
        public static readonly SolidColorBrush BorderBrush = BrushHex("#E4D8C4");
        public static readonly SolidColorBrush BorderLight = BrushHex("#D2C2A8");

        // Brand Core: Forest Green (#1F3D2B), Sand Beige (#E8DCC4), Electric Purple (#8B5CF6)
        public static readonly SolidColorBrush ForestGreen = BrushHex("#1F3D2B");
        public static readonly SolidColorBrush ForestGreenHover = BrushHex("#295039");
        public static readonly SolidColorBrush SandBeige = BrushHex("#E8DCC4");
        public static readonly SolidColorBrush SandBeigeHover = BrushHex("#DFCFB2");
        public static readonly SolidColorBrush SandBeigeBg = BrushHex("#F5EFE4");

        public static readonly SolidColorBrush ElectricPurple = BrushHex("#8B5CF6");
        public static readonly SolidColorBrush ElectricPurpleHover = BrushHex("#7C3AED");
        public static readonly SolidColorBrush ElectricPurpleSoft = BrushHex("#EDE9FE");
        public static readonly SolidColorBrush ElectricPurpleBorder = BrushHex("#C4B5FD");
        public static readonly SolidColorBrush PureWhite = BrushHex("#FFFDF9");

        // Editorial High-Contrast Typography (Deep Forest Green Ink on Warm Ivory)
        public static readonly SolidColorBrush TextMain = BrushHex("#1F3D2B");
        public static readonly SolidColorBrush TextMuted = BrushHex("#5C6B60");
        public static readonly SolidColorBrush TextDim = BrushHex("#8B8477");
        public static readonly SolidColorBrush AccentWhite = BrushHex("#1F3D2B");
        public static readonly SolidColorBrush AccentBlack = BrushHex("#FFFDF9");

        // Soft Pastel Semantic Pills & Status Badges
        public static readonly SolidColorBrush Green = BrushHex("#0D7A52");
        public static readonly SolidColorBrush GreenBg = BrushHex("#E3F6EC");
        public static readonly SolidColorBrush Yellow = BrushHex("#B45309");
        public static readonly SolidColorBrush YellowBg = BrushHex("#FEF3C7");
        public static readonly SolidColorBrush Red = BrushHex("#C83E3E");
        public static readonly SolidColorBrush RedBg = BrushHex("#FDF2F2");
        public static readonly SolidColorBrush Indigo = BrushHex("#6D28D9");
        public static readonly SolidColorBrush IndigoBg = BrushHex("#EDE9FE");

        public static SolidColorBrush BrushHex(string hex)
        {
            Color c = (Color)ColorConverter.ConvertFromString(hex);
            SolidColorBrush b = new SolidColorBrush(c);
            b.Freeze();
            return b;
        }

        public static SolidColorBrush BrushRgba(byte r, byte g, byte b, byte a)
        {
            SolidColorBrush br = new SolidColorBrush(Color.FromArgb(a, r, g, b));
            br.Freeze();
            return br;
        }

        public static LinearGradientBrush CreateHeroPurpleGradient()
        {
            LinearGradientBrush lg = new LinearGradientBrush(
                (Color)ColorConverter.ConvertFromString("#EDE9FE"),
                (Color)ColorConverter.ConvertFromString("#DDD6FE"),
                new Point(0, 0),
                new Point(1, 1));
            lg.Freeze();
            return lg;
        }

        public static DropShadowEffect CreateCardShadow()
        {
            DropShadowEffect fx = new DropShadowEffect
            {
                Color = Color.FromRgb(82, 68, 45),
                BlurRadius = 18,
                ShadowDepth = 3,
                Direction = 270,
                Opacity = 0.06
            };
            fx.Freeze();
            return fx;
        }

        public static Border CreateCard(Thickness padding, Thickness margin)
        {
            return new Border
            {
                Background = BgCard,
                BorderBrush = BorderBrush,
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(16),
                Padding = padding,
                Margin = margin,
                Effect = CreateCardShadow()
            };
        }

        public static Border CreateSubCard(Thickness padding, Thickness margin)
        {
            return new Border
            {
                Background = BgInput,
                BorderBrush = BorderBrush,
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(12),
                Padding = padding,
                Margin = margin
            };
        }

        public static Border CreateIconBox(string iconText, bool isAccentPurple = false)
        {
            return new Border
            {
                Width = 36,
                Height = 36,
                CornerRadius = new CornerRadius(10),
                Background = isAccentPurple ? ElectricPurpleSoft : SandBeige,
                BorderBrush = isAccentPurple ? ElectricPurpleBorder : BorderLight,
                BorderThickness = new Thickness(1),
                Margin = new Thickness(0, 0, 10, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Child = new TextBlock
                {
                    Text = iconText,
                    FontSize = 15,
                    FontWeight = FontWeights.Bold,
                    Foreground = isAccentPurple ? Indigo : ForestGreen,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center
                }
            };
        }

        public static TextBlock CreateText(string text, double size, FontWeight weight, Brush fg, Thickness margin = default(Thickness))
        {
            return new TextBlock
            {
                Text = text ?? "",
                FontSize = size,
                FontWeight = weight,
                Foreground = fg ?? TextMain,
                Margin = margin,
                TextWrapping = TextWrapping.Wrap,
                VerticalAlignment = VerticalAlignment.Center
            };
        }

        public static TextBox CreateInput(string text = "", string tooltip = "", double width = double.NaN)
        {
            TextBox tb = new TextBox
            {
                Text = text ?? "",
                Background = BgInput,
                Foreground = ForestGreen,
                CaretBrush = ForestGreen,
                SelectionBrush = ElectricPurple,
                BorderBrush = BorderLight,
                BorderThickness = new Thickness(1),
                Padding = new Thickness(11, 7, 11, 7),
                FontSize = 12.5,
                FontWeight = FontWeights.Medium,
                VerticalContentAlignment = VerticalAlignment.Center
            };

            ControlTemplate tpl = new ControlTemplate(typeof(TextBox));
            FrameworkElementFactory bd = new FrameworkElementFactory(typeof(Border));
            bd.Name = "InputBorder";
            bd.SetValue(Border.BackgroundProperty, new TemplateBindingExtension(Control.BackgroundProperty));
            bd.SetValue(Border.BorderBrushProperty, new TemplateBindingExtension(Control.BorderBrushProperty));
            bd.SetValue(Border.BorderThicknessProperty, new TemplateBindingExtension(Control.BorderThicknessProperty));
            bd.SetValue(Border.CornerRadiusProperty, new CornerRadius(10));

            FrameworkElementFactory sv = new FrameworkElementFactory(typeof(ScrollViewer));
            sv.Name = "PART_ContentHost";
            sv.SetValue(FrameworkElement.MarginProperty, new Thickness(2, 0, 2, 0));
            bd.AppendChild(sv);
            tpl.VisualTree = bd;

            Trigger hoverTrig = new Trigger { Property = UIElement.IsMouseOverProperty, Value = true };
            hoverTrig.Setters.Add(new Setter(Border.BorderBrushProperty, ForestGreen, "InputBorder"));
            tpl.Triggers.Add(hoverTrig);

            Trigger focusTrig = new Trigger { Property = UIElement.IsKeyboardFocusedProperty, Value = true };
            focusTrig.Setters.Add(new Setter(Border.BorderBrushProperty, ElectricPurple, "InputBorder"));
            focusTrig.Setters.Add(new Setter(Border.BackgroundProperty, BgCard, "InputBorder"));
            tpl.Triggers.Add(focusTrig);

            tb.Template = tpl;
            if (!double.IsNaN(width)) tb.Width = width;
            if (!string.IsNullOrEmpty(tooltip)) tb.ToolTip = tooltip;
            return tb;
        }

        public static PasswordBox CreatePasswordInput(string password = "")
        {
            PasswordBox pb = new PasswordBox
            {
                Password = password ?? "",
                Background = BgInput,
                Foreground = ForestGreen,
                CaretBrush = ForestGreen,
                SelectionBrush = ElectricPurple,
                BorderBrush = BorderLight,
                BorderThickness = new Thickness(1),
                Padding = new Thickness(11, 7, 11, 7),
                FontSize = 12.5,
                VerticalContentAlignment = VerticalAlignment.Center
            };

            ControlTemplate tpl = new ControlTemplate(typeof(PasswordBox));
            FrameworkElementFactory bd = new FrameworkElementFactory(typeof(Border));
            bd.Name = "PwdBorder";
            bd.SetValue(Border.BackgroundProperty, new TemplateBindingExtension(Control.BackgroundProperty));
            bd.SetValue(Border.BorderBrushProperty, new TemplateBindingExtension(Control.BorderBrushProperty));
            bd.SetValue(Border.BorderThicknessProperty, new TemplateBindingExtension(Control.BorderThicknessProperty));
            bd.SetValue(Border.CornerRadiusProperty, new CornerRadius(10));

            FrameworkElementFactory sv = new FrameworkElementFactory(typeof(ScrollViewer));
            sv.Name = "PART_ContentHost";
            sv.SetValue(FrameworkElement.MarginProperty, new Thickness(2, 0, 2, 0));
            bd.AppendChild(sv);
            tpl.VisualTree = bd;

            Trigger hoverTrig = new Trigger { Property = UIElement.IsMouseOverProperty, Value = true };
            hoverTrig.Setters.Add(new Setter(Border.BorderBrushProperty, ForestGreen, "PwdBorder"));
            tpl.Triggers.Add(hoverTrig);

            Trigger focusTrig = new Trigger { Property = UIElement.IsKeyboardFocusedProperty, Value = true };
            focusTrig.Setters.Add(new Setter(Border.BorderBrushProperty, ElectricPurple, "PwdBorder"));
            focusTrig.Setters.Add(new Setter(Border.BackgroundProperty, BgCard, "PwdBorder"));
            tpl.Triggers.Add(focusTrig);

            pb.Template = tpl;
            return pb;
        }

        public static CheckBox CreateCheckBox(string label, bool isChecked = false)
        {
            CheckBox cb = new CheckBox
            {
                Content = new TextBlock
                {
                    Text = label,
                    Foreground = ForestGreen,
                    FontSize = 12.5,
                    FontWeight = FontWeights.Medium,
                    TextWrapping = TextWrapping.Wrap,
                    VerticalAlignment = VerticalAlignment.Center
                },
                IsChecked = isChecked,
                Foreground = ForestGreen,
                VerticalContentAlignment = VerticalAlignment.Center,
                Margin = new Thickness(0, 4, 12, 4),
                Cursor = Cursors.Hand
            };

            ControlTemplate tpl = new ControlTemplate(typeof(CheckBox));
            FrameworkElementFactory sp = new FrameworkElementFactory(typeof(StackPanel));
            sp.SetValue(StackPanel.OrientationProperty, Orientation.Horizontal);
            sp.SetValue(FrameworkElement.VerticalAlignmentProperty, VerticalAlignment.Center);

            FrameworkElementFactory box = new FrameworkElementFactory(typeof(Border));
            box.Name = "ChkBoxBorder";
            box.SetValue(FrameworkElement.WidthProperty, 18.0);
            box.SetValue(FrameworkElement.HeightProperty, 18.0);
            box.SetValue(Border.CornerRadiusProperty, new CornerRadius(5));
            box.SetValue(Border.BackgroundProperty, BgInput);
            box.SetValue(Border.BorderBrushProperty, BorderLight);
            box.SetValue(Border.BorderThicknessProperty, new Thickness(1.5));
            box.SetValue(FrameworkElement.MarginProperty, new Thickness(0, 0, 8, 0));
            box.SetValue(FrameworkElement.VerticalAlignmentProperty, VerticalAlignment.Center);

            FrameworkElementFactory mark = new FrameworkElementFactory(typeof(TextBlock));
            mark.Name = "ChkMark";
            mark.SetValue(TextBlock.TextProperty, "✓");
            mark.SetValue(TextBlock.FontSizeProperty, 12.0);
            mark.SetValue(TextBlock.FontWeightProperty, FontWeights.ExtraBold);
            mark.SetValue(TextBlock.ForegroundProperty, PureWhite);
            mark.SetValue(FrameworkElement.HorizontalAlignmentProperty, HorizontalAlignment.Center);
            mark.SetValue(FrameworkElement.VerticalAlignmentProperty, VerticalAlignment.Center);
            mark.SetValue(UIElement.VisibilityProperty, Visibility.Collapsed);
            box.AppendChild(mark);
            sp.AppendChild(box);

            FrameworkElementFactory cp = new FrameworkElementFactory(typeof(ContentPresenter));
            cp.SetValue(FrameworkElement.VerticalAlignmentProperty, VerticalAlignment.Center);
            sp.AppendChild(cp);

            tpl.VisualTree = sp;

            Trigger checkedTrig = new Trigger { Property = ToggleButton.IsCheckedProperty, Value = true };
            checkedTrig.Setters.Add(new Setter(Border.BackgroundProperty, ForestGreen, "ChkBoxBorder"));
            checkedTrig.Setters.Add(new Setter(Border.BorderBrushProperty, ForestGreen, "ChkBoxBorder"));
            checkedTrig.Setters.Add(new Setter(UIElement.VisibilityProperty, Visibility.Visible, "ChkMark"));
            tpl.Triggers.Add(checkedTrig);

            Trigger hoverTrig = new Trigger { Property = UIElement.IsMouseOverProperty, Value = true };
            hoverTrig.Setters.Add(new Setter(Border.BorderBrushProperty, ElectricPurple, "ChkBoxBorder"));
            tpl.Triggers.Add(hoverTrig);

            cb.Template = tpl;
            return cb;
        }

        public static ComboBox CreateComboBox(string[] items, int selectedIndex = 0)
        {
            ComboBox cb = new ComboBox
            {
                Background = BgCard,
                Foreground = ForestGreen,
                BorderBrush = BorderLight,
                BorderThickness = new Thickness(1),
                Padding = new Thickness(11, 6, 11, 6),
                FontSize = 12.5,
                FontWeight = FontWeights.SemiBold,
                VerticalContentAlignment = VerticalAlignment.Center,
                Cursor = Cursors.Hand
            };

            cb.Resources[SystemColors.WindowBrushKey] = BgCard;
            cb.Resources[SystemColors.ControlTextBrushKey] = ForestGreen;
            cb.Resources[SystemColors.HighlightBrushKey] = ElectricPurpleSoft;
            cb.Resources[SystemColors.HighlightTextBrushKey] = Indigo;

            Style itemStyle = new Style(typeof(ComboBoxItem));
            itemStyle.Setters.Add(new Setter(Control.BackgroundProperty, BgCard));
            itemStyle.Setters.Add(new Setter(Control.ForegroundProperty, ForestGreen));
            itemStyle.Setters.Add(new Setter(Control.BorderThicknessProperty, new Thickness(0)));
            itemStyle.Setters.Add(new Setter(Control.PaddingProperty, new Thickness(10, 6, 10, 6)));
            Trigger itemHover = new Trigger { Property = UIElement.IsMouseOverProperty, Value = true };
            itemHover.Setters.Add(new Setter(Control.BackgroundProperty, ElectricPurpleSoft));
            itemHover.Setters.Add(new Setter(Control.ForegroundProperty, Indigo));
            itemStyle.Triggers.Add(itemHover);
            Trigger itemSel = new Trigger { Property = ListBoxItem.IsSelectedProperty, Value = true };
            itemSel.Setters.Add(new Setter(Control.BackgroundProperty, SandBeige));
            itemSel.Setters.Add(new Setter(Control.ForegroundProperty, ForestGreen));
            itemStyle.Triggers.Add(itemSel);
            cb.ItemContainerStyle = itemStyle;

            ControlTemplate tpl = new ControlTemplate(typeof(ComboBox));
            FrameworkElementFactory grid = new FrameworkElementFactory(typeof(Grid));

            FrameworkElementFactory toggle = new FrameworkElementFactory(typeof(ToggleButton));
            toggle.Name = "ToggleButton";
            toggle.SetValue(ToggleButton.ClickModeProperty, ClickMode.Press);
            toggle.SetValue(UIElement.FocusableProperty, false);
            Binding openBind = new Binding("IsDropDownOpen") { RelativeSource = new RelativeSource(RelativeSourceMode.TemplatedParent), Mode = BindingMode.TwoWay };
            toggle.SetBinding(ToggleButton.IsCheckedProperty, openBind);

            ControlTemplate toggleTpl = new ControlTemplate(typeof(ToggleButton));
            FrameworkElementFactory tBorder = new FrameworkElementFactory(typeof(Border));
            tBorder.Name = "CmbBorder";
            tBorder.SetValue(Border.BackgroundProperty, BgCard);
            tBorder.SetValue(Border.BorderBrushProperty, BorderLight);
            tBorder.SetValue(Border.BorderThicknessProperty, new Thickness(1));
            tBorder.SetValue(Border.CornerRadiusProperty, new CornerRadius(10));

            FrameworkElementFactory arrow = new FrameworkElementFactory(typeof(TextBlock));
            arrow.SetValue(TextBlock.TextProperty, "▾");
            arrow.SetValue(TextBlock.ForegroundProperty, ForestGreen);
            arrow.SetValue(TextBlock.FontSizeProperty, 12.0);
            arrow.SetValue(FrameworkElement.HorizontalAlignmentProperty, HorizontalAlignment.Right);
            arrow.SetValue(FrameworkElement.VerticalAlignmentProperty, VerticalAlignment.Center);
            arrow.SetValue(FrameworkElement.MarginProperty, new Thickness(0, 0, 10, 0));
            tBorder.AppendChild(arrow);
            toggleTpl.VisualTree = tBorder;

            Trigger tHover = new Trigger { Property = UIElement.IsMouseOverProperty, Value = true };
            tHover.Setters.Add(new Setter(Border.BorderBrushProperty, ElectricPurple, "CmbBorder"));
            toggleTpl.Triggers.Add(tHover);

            toggle.SetValue(Control.TemplateProperty, toggleTpl);
            grid.AppendChild(toggle);

            FrameworkElementFactory contentSite = new FrameworkElementFactory(typeof(ContentPresenter));
            contentSite.Name = "ContentSite";
            contentSite.SetValue(UIElement.IsHitTestVisibleProperty, false);
            contentSite.SetValue(ContentPresenter.ContentProperty, new TemplateBindingExtension(ComboBox.SelectionBoxItemProperty));
            contentSite.SetValue(ContentPresenter.ContentTemplateProperty, new TemplateBindingExtension(ComboBox.SelectionBoxItemTemplateProperty));
            contentSite.SetValue(FrameworkElement.MarginProperty, new Thickness(12, 6, 26, 6));
            contentSite.SetValue(FrameworkElement.VerticalAlignmentProperty, VerticalAlignment.Center);
            contentSite.SetValue(FrameworkElement.HorizontalAlignmentProperty, HorizontalAlignment.Left);
            grid.AppendChild(contentSite);

            FrameworkElementFactory popup = new FrameworkElementFactory(typeof(Popup));
            popup.Name = "Popup";
            popup.SetValue(Popup.PlacementProperty, PlacementMode.Bottom);
            popup.SetValue(Popup.AllowsTransparencyProperty, true);
            popup.SetValue(UIElement.FocusableProperty, false);
            popup.SetValue(Popup.PopupAnimationProperty, PopupAnimation.Fade);
            Binding popOpenBind = new Binding("IsDropDownOpen") { RelativeSource = new RelativeSource(RelativeSourceMode.TemplatedParent) };
            popup.SetBinding(Popup.IsOpenProperty, popOpenBind);

            FrameworkElementFactory popBorder = new FrameworkElementFactory(typeof(Border));
            popBorder.SetValue(Border.BackgroundProperty, BgCard);
            popBorder.SetValue(Border.BorderBrushProperty, BorderLight);
            popBorder.SetValue(Border.BorderThicknessProperty, new Thickness(1));
            popBorder.SetValue(Border.CornerRadiusProperty, new CornerRadius(10));
            popBorder.SetValue(FrameworkElement.MinWidthProperty, 120.0);
            popBorder.SetValue(FrameworkElement.MaxHeightProperty, 240.0);

            FrameworkElementFactory popSv = new FrameworkElementFactory(typeof(ScrollViewer));
            popSv.SetValue(ScrollViewer.VerticalScrollBarVisibilityProperty, ScrollBarVisibility.Auto);
            FrameworkElementFactory itemsPres = new FrameworkElementFactory(typeof(ItemsPresenter));
            popSv.AppendChild(itemsPres);
            popBorder.AppendChild(popSv);
            popup.AppendChild(popBorder);
            grid.AppendChild(popup);

            tpl.VisualTree = grid;
            cb.Template = tpl;

            if (items != null)
            {
                for (int i = 0; i < items.Length; i++) cb.Items.Add(items[i]);
                if (items.Length > 0 && selectedIndex >= 0 && selectedIndex < items.Length)
                    cb.SelectedIndex = selectedIndex;
            }
            return cb;
        }

        public static Button CreateButton(string text, string variant = "outline", RoutedEventHandler onClick = null, Thickness padding = default(Thickness))
        {
            if (padding == default(Thickness)) padding = new Thickness(13, 6, 13, 6);

            Brush bg = BgInput;
            Brush fg = ForestGreen;
            Brush bd = BorderLight;

            if (variant == "primary")
            {
                bg = ForestGreen;
                fg = PureWhite;
                bd = ForestGreen;
            }
            else if (variant == "purple" || variant == "accent")
            {
                bg = ElectricPurple;
                fg = PureWhite;
                bd = ElectricPurple;
            }
            else if (variant == "sand" || variant == "beige")
            {
                bg = SandBeige;
                fg = ForestGreen;
                bd = BorderLight;
            }
            else if (variant == "success")
            {
                bg = GreenBg;
                fg = Green;
                bd = BrushHex("#A7F3D0");
            }
            else if (variant == "danger")
            {
                bg = RedBg;
                fg = Red;
                bd = BrushHex("#FECACA");
            }
            else if (variant == "warning")
            {
                bg = YellowBg;
                fg = Yellow;
                bd = BrushHex("#FDE68A");
            }
            else if (variant == "indigo")
            {
                bg = IndigoBg;
                fg = Indigo;
                bd = ElectricPurpleBorder;
            }

            Button btn = new Button
            {
                Content = text,
                Background = bg,
                Foreground = fg,
                BorderBrush = bd,
                BorderThickness = new Thickness(1),
                Padding = padding,
                FontSize = 12,
                FontWeight = FontWeights.Bold,
                Cursor = Cursors.Hand,
                Margin = new Thickness(2.5)
            };

            ControlTemplate tpl = new ControlTemplate(typeof(Button));
            FrameworkElementFactory borderFactory = new FrameworkElementFactory(typeof(Border));
            borderFactory.Name = "BtnBorder";
            borderFactory.SetValue(Border.BackgroundProperty, new TemplateBindingExtension(Control.BackgroundProperty));
            borderFactory.SetValue(Border.BorderBrushProperty, new TemplateBindingExtension(Control.BorderBrushProperty));
            borderFactory.SetValue(Border.BorderThicknessProperty, new TemplateBindingExtension(Control.BorderThicknessProperty));
            borderFactory.SetValue(Border.CornerRadiusProperty, new CornerRadius(12));
            borderFactory.SetValue(Border.PaddingProperty, new TemplateBindingExtension(Control.PaddingProperty));

            FrameworkElementFactory contentFactory = new FrameworkElementFactory(typeof(ContentPresenter));
            contentFactory.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
            contentFactory.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
            borderFactory.AppendChild(contentFactory);

            tpl.VisualTree = borderFactory;

            Trigger hoverTrigger = new Trigger { Property = UIElement.IsMouseOverProperty, Value = true };
            hoverTrigger.Setters.Add(new Setter(Border.BorderBrushProperty, ElectricPurple, "BtnBorder"));
            hoverTrigger.Setters.Add(new Setter(UIElement.OpacityProperty, 0.90));
            tpl.Triggers.Add(hoverTrigger);

            Trigger disabledTrigger = new Trigger { Property = UIElement.IsEnabledProperty, Value = false };
            disabledTrigger.Setters.Add(new Setter(UIElement.OpacityProperty, 0.45));
            tpl.Triggers.Add(disabledTrigger);

            btn.Template = tpl;

            if (onClick != null) btn.Click += onClick;
            return btn;
        }

        public static void SetButtonVariant(Button btn, string text, string variant)
        {
            if (btn == null) return;
            btn.Content = text;
            if (variant == "primary")
            {
                btn.Background = ForestGreen;
                btn.Foreground = PureWhite;
                btn.BorderBrush = ForestGreen;
            }
            else if (variant == "purple" || variant == "accent")
            {
                btn.Background = ElectricPurple;
                btn.Foreground = PureWhite;
                btn.BorderBrush = ElectricPurple;
            }
            else if (variant == "sand" || variant == "beige")
            {
                btn.Background = SandBeige;
                btn.Foreground = ForestGreen;
                btn.BorderBrush = BorderLight;
            }
            else if (variant == "success")
            {
                btn.Background = GreenBg;
                btn.Foreground = Green;
                btn.BorderBrush = BrushHex("#A7F3D0");
            }
            else if (variant == "danger")
            {
                btn.Background = RedBg;
                btn.Foreground = Red;
                btn.BorderBrush = BrushHex("#FECACA");
            }
            else if (variant == "warning")
            {
                btn.Background = YellowBg;
                btn.Foreground = Yellow;
                btn.BorderBrush = BrushHex("#FDE68A");
            }
            else if (variant == "indigo")
            {
                btn.Background = IndigoBg;
                btn.Foreground = Indigo;
                btn.BorderBrush = ElectricPurpleBorder;
            }
            else
            {
                btn.Background = BgInput;
                btn.Foreground = ForestGreen;
                btn.BorderBrush = BorderLight;
            }
        }

        public static Border CreateBadge(string text, Brush fg, Brush bg, Brush border = null)
        {
            Border b = new Border
            {
                Background = bg,
                BorderBrush = border ?? fg,
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(8, 2, 8, 2),
                Margin = new Thickness(2),
                VerticalAlignment = VerticalAlignment.Center,
                Child = new TextBlock
                {
                    Text = text,
                    Foreground = fg,
                    FontSize = 11,
                    FontWeight = FontWeights.Bold
                }
            };
            return b;
        }
    }

    // =========================================================================
    // MODALS / DIALOGS
    // =========================================================================
    public class KeyAuthModal : Window
    {
        private readonly SctPipeClient pipe;
        private readonly Action onSuccess;
        private TextBox txtLoginUser;
        private PasswordBox txtLoginPass;
        private CheckBox chkLoginRemember;
        private TextBox txtRegUser;
        private PasswordBox txtRegPass;
        private TextBox txtRegKey;
        private CheckBox chkRegRemember;
        private TextBox txtLicenseKeyOnly;
        private TextBlock lblStatus;

        public KeyAuthModal(Window owner, SctPipeClient pipeClient, string initialMessage, Action onSuccessCallback)
        {
            Owner = owner;
            pipe = pipeClient;
            onSuccess = onSuccessCallback;
            Title = "KeyAuth Lisans & Paket Yönetimi";
            Width = 500;
            Height = 490;
            WindowStartupLocation = WindowStartupLocation.CenterOwner;
            Background = UiTheme.BgBase;
            Foreground = UiTheme.TextMain;
            ResizeMode = ResizeMode.NoResize;

            Border root = UiTheme.CreateCard(new Thickness(18), new Thickness(10));
            StackPanel stack = new StackPanel();

            stack.Children.Add(UiTheme.CreateText("🔑 SCT AFK Service - KeyAuth Lisans & PRO Paket", 16, FontWeights.ExtraBold, UiTheme.AccentWhite, new Thickness(0, 0, 0, 4)));
            stack.Children.Add(UiTheme.CreateText("Sınırsız hesap, Proxy Havuzu, Oto-İnşa (Schematica), Koruma & Anti-Cheat Spoofing ve 3D Canlı Radar özelliklerini açmak için giriş yapın veya lisans anahtarı kullanın.", 12, FontWeights.Normal, UiTheme.TextMuted, new Thickness(0, 0, 0, 12)));

            lblStatus = UiTheme.CreateText(initialMessage ?? "", 12, FontWeights.Bold, UiTheme.Yellow, new Thickness(0, 0, 0, 10));
            lblStatus.Visibility = string.IsNullOrEmpty(initialMessage) ? Visibility.Collapsed : Visibility.Visible;
            stack.Children.Add(lblStatus);

            TabControl tabs = new TabControl
            {
                Background = UiTheme.BgSidebar,
                BorderBrush = UiTheme.BorderBrush,
                Height = 290
            };

            // Tab 1: Login
            TabItem tabLogin = new TabItem { Header = "PRO Giriş Yap" };
            StackPanel spLogin = new StackPanel { Margin = new Thickness(12) };
            spLogin.Children.Add(UiTheme.CreateText("Kullanıcı Adı", 12, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 4, 0, 4)));
            txtLoginUser = UiTheme.CreateInput();
            spLogin.Children.Add(txtLoginUser);
            spLogin.Children.Add(UiTheme.CreateText("Şifre", 12, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 10, 0, 4)));
            txtLoginPass = UiTheme.CreatePasswordInput();
            spLogin.Children.Add(txtLoginPass);
            chkLoginRemember = UiTheme.CreateCheckBox("Oturumu bu bilgisayarda hatırla", true);
            chkLoginRemember.Margin = new Thickness(0, 10, 0, 12);
            spLogin.Children.Add(chkLoginRemember);
            Button btnDoLogin = UiTheme.CreateButton("🚀 PRO Hesaba Giriş Yap", "primary", OnLoginClick, new Thickness(14, 8, 14, 8));
            spLogin.Children.Add(btnDoLogin);
            tabLogin.Content = spLogin;
            tabs.Items.Add(tabLogin);

            // Tab 2: Register with Key
            TabItem tabReg = new TabItem { Header = "Kayıt Ol + Anahtar" };
            StackPanel spReg = new StackPanel { Margin = new Thickness(12) };
            spReg.Children.Add(UiTheme.CreateText("Kullanıcı Adı", 11.5, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 2, 0, 2)));
            txtRegUser = UiTheme.CreateInput();
            spReg.Children.Add(txtRegUser);
            spReg.Children.Add(UiTheme.CreateText("Şifre", 11.5, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 6, 0, 2)));
            txtRegPass = UiTheme.CreatePasswordInput();
            spReg.Children.Add(txtRegPass);
            spReg.Children.Add(UiTheme.CreateText("PRO Lisans Anahtarı (Key)", 11.5, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 6, 0, 2)));
            txtRegKey = UiTheme.CreateInput("", "SCT-PRO-XXXX-XXXX");
            spReg.Children.Add(txtRegKey);
            chkRegRemember = UiTheme.CreateCheckBox("Beni hatırla", true);
            spReg.Children.Add(chkRegRemember);
            Button btnDoReg = UiTheme.CreateButton("✨ Kayıt Ol & PRO Aktifleştir", "primary", OnRegisterClick, new Thickness(14, 7, 14, 7));
            spReg.Children.Add(btnDoReg);
            tabReg.Content = spReg;
            tabs.Items.Add(tabReg);

            // Tab 3: Direct License Key / Upgrade
            TabItem tabKey = new TabItem { Header = "Sadece Lisans Anahtarı / PRO Satın Al" };
            StackPanel spKey = new StackPanel { Margin = new Thickness(12) };
            spKey.Children.Add(UiTheme.CreateText("Hızlı Lisans Anahtarı Aktivasyonu", 12, FontWeights.Bold, UiTheme.TextMain, new Thickness(0, 4, 0, 4)));
            txtLicenseKeyOnly = UiTheme.CreateInput("", "KeyAuth Lisans Anahtarınızı girin...");
            spKey.Children.Add(txtLicenseKeyOnly);
            Button btnDoLicense = UiTheme.CreateButton("🔑 Anahtar ile Doğrula", "primary", OnLicenseOnlyClick, new Thickness(14, 8, 14, 8));
            btnDoLicense.Margin = new Thickness(0, 10, 0, 14);
            spKey.Children.Add(btnDoLicense);

            Border upgradeCard = UiTheme.CreateCard(new Thickness(10), new Thickness(0));
            StackPanel spUp = new StackPanel();
            spUp.Children.Add(UiTheme.CreateText("💎 PRO Paket (175.00 TL) Satın Almak İçin:", 12.5, FontWeights.Bold, UiTheme.Green));
            spUp.Children.Add(UiTheme.CreateText("Discord üzerinden 'cagat' kullanıcı adına mesaj göndererek anında PRO lisans anahtarınızı teslim alabilirsiniz.", 11.5, FontWeights.Normal, UiTheme.TextMuted, new Thickness(0, 4, 0, 8)));
            StackPanel spUpBtns = new StackPanel { Orientation = Orientation.Horizontal };
            spUpBtns.Children.Add(UiTheme.CreateButton("📋 Discord Adını Kopyala (cagat)", "outline", delegate
            {
                try { Clipboard.SetText("cagat"); } catch { }
                SetAlert("Discord kullanıcı adı 'cagat' panoya kopyalandı!", UiTheme.Green);
            }));
            spUpBtns.Children.Add(UiTheme.CreateButton("💬 Discord Profilini Aç", "indigo", delegate
            {
                pipe.SendApiAsync("GET", "/api/open-external?url=" + Uri.EscapeDataString("https://discord.com/users/363769057113014284"), null);
            }));
            spUp.Children.Add(spUpBtns);
            upgradeCard.Child = spUp;
            spKey.Children.Add(upgradeCard);

            tabKey.Content = spKey;
            tabs.Items.Add(tabKey);

            stack.Children.Add(tabs);

            StackPanel footer = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 12, 0, 0) };
            footer.Children.Add(UiTheme.CreateButton("Kapat", "outline", delegate { Close(); }));
            stack.Children.Add(footer);

            root.Child = stack;
            Content = root;
        }

        private void SetAlert(string msg, Brush color)
        {
            lblStatus.Text = msg ?? "";
            lblStatus.Foreground = color ?? UiTheme.Yellow;
            lblStatus.Visibility = string.IsNullOrEmpty(msg) ? Visibility.Collapsed : Visibility.Visible;
        }

        private void OnLoginClick(object sender, RoutedEventArgs e)
        {
            string u = txtLoginUser.Text.Trim();
            string p = txtLoginPass.Password;
            if (string.IsNullOrEmpty(u) || string.IsNullOrEmpty(p))
            {
                SetAlert("Lütfen kullanıcı adı ve şifrenizi girin.", UiTheme.Red);
                return;
            }
            SetAlert("KeyAuth sunucusu doğrulanıyor...", UiTheme.Yellow);
            Dictionary<string, object> body = new Dictionary<string, object>();
            body["username"] = u;
            body["password"] = p;
            body["remember"] = chkLoginRemember.IsChecked == true;
            pipe.SendApiAsync("POST", "/api/keyauth/login", body, delegate(int status, Dictionary<string, object> data)
            {
                if (JsonHelper.Bool(data, "ok", false))
                {
                    if (onSuccess != null) onSuccess();
                    Close();
                }
                else
                {
                    SetAlert(JsonHelper.Str(data, "error", "Giriş başarısız."), UiTheme.Red);
                }
            });
        }

        private void OnRegisterClick(object sender, RoutedEventArgs e)
        {
            string u = txtRegUser.Text.Trim();
            string p = txtRegPass.Password;
            string k = txtRegKey.Text.Trim();
            if (string.IsNullOrEmpty(u) || string.IsNullOrEmpty(p) || string.IsNullOrEmpty(k))
            {
                SetAlert("Lütfen kullanıcı adı, şifre ve lisans anahtarını eksiksiz girin.", UiTheme.Red);
                return;
            }
            SetAlert("Lisans anahtarı aktifleştiriliyor...", UiTheme.Yellow);
            Dictionary<string, object> body = new Dictionary<string, object>();
            body["username"] = u;
            body["password"] = p;
            body["key"] = k;
            body["remember"] = chkRegRemember.IsChecked == true;
            pipe.SendApiAsync("POST", "/api/keyauth/register", body, delegate(int status, Dictionary<string, object> data)
            {
                if (JsonHelper.Bool(data, "ok", false))
                {
                    if (onSuccess != null) onSuccess();
                    Close();
                }
                else
                {
                    SetAlert(JsonHelper.Str(data, "error", "Kayıt başarısız."), UiTheme.Red);
                }
            });
        }

        private void OnLicenseOnlyClick(object sender, RoutedEventArgs e)
        {
            string k = txtLicenseKeyOnly.Text.Trim();
            if (string.IsNullOrEmpty(k))
            {
                SetAlert("Lütfen lisans anahtarınızı girin.", UiTheme.Red);
                return;
            }
            SetAlert("Lisans anahtarı doğrulanıyor...", UiTheme.Yellow);
            Dictionary<string, object> body = new Dictionary<string, object>();
            body["key"] = k;
            body["remember"] = true;
            pipe.SendApiAsync("POST", "/api/keyauth/license", body, delegate(int status, Dictionary<string, object> data)
            {
                if (JsonHelper.Bool(data, "ok", false))
                {
                    if (onSuccess != null) onSuccess();
                    Close();
                }
                else
                {
                    SetAlert(JsonHelper.Str(data, "error", "Anahtar doğrulanamadı. Kayıt sekmesinden kullanıcı adı ve şifre ile deneyin."), UiTheme.Red);
                }
            });
        }
    }

    public class ServerModal : Window
    {
        private readonly SctPipeClient pipe;
        private readonly string editServerId;
        private readonly Action onSaved;
        private TextBox txtName;
        private TextBox txtHost;
        private TextBox txtPort;
        private ComboBox cmbVersion;
        private TextBox txtCustomVersion;

        public ServerModal(Window owner, SctPipeClient pipeClient, Dictionary<string, object> existingSrv, Action onSavedCallback)
        {
            Owner = owner;
            pipe = pipeClient;
            onSaved = onSavedCallback;
            editServerId = existingSrv != null ? JsonHelper.Str(existingSrv, "id", "") : "";

            Title = string.IsNullOrEmpty(editServerId) ? "Yeni Sunucu Ekle" : "Sunucuyu Düzenle";
            Width = 440;
            Height = 380;
            WindowStartupLocation = WindowStartupLocation.CenterOwner;
            Background = UiTheme.BgBase;
            Foreground = UiTheme.TextMain;
            ResizeMode = ResizeMode.NoResize;

            Border card = UiTheme.CreateCard(new Thickness(18), new Thickness(10));
            StackPanel sp = new StackPanel();

            sp.Children.Add(UiTheme.CreateText(Title, 15, FontWeights.ExtraBold, UiTheme.AccentWhite, new Thickness(0, 0, 0, 12)));

            sp.Children.Add(UiTheme.CreateText("Sunucu Adı (Takma Ad)", 12, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 2, 0, 4)));
            txtName = UiTheme.CreateInput(existingSrv != null ? JsonHelper.Str(existingSrv, "name", "") : "", "Örn: Skyblock Sunucusu");
            sp.Children.Add(txtName);

            Grid hostPortGrid = new Grid { Margin = new Thickness(0, 10, 0, 0) };
            hostPortGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });
            hostPortGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
            hostPortGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            StackPanel spHost = new StackPanel();
            spHost.Children.Add(UiTheme.CreateText("Sunucu Adresi (IP / Domain)", 12, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 0, 0, 4)));
            txtHost = UiTheme.CreateInput(existingSrv != null ? JsonHelper.Str(existingSrv, "host", "") : "", "oyna.sunucu.com");
            spHost.Children.Add(txtHost);
            Grid.SetColumn(spHost, 0);
            hostPortGrid.Children.Add(spHost);

            StackPanel spPort = new StackPanel();
            spPort.Children.Add(UiTheme.CreateText("Port", 12, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 0, 0, 4)));
            txtPort = UiTheme.CreateInput(existingSrv != null ? JsonHelper.Int(existingSrv, "port", 25565).ToString() : "25565");
            spPort.Children.Add(txtPort);
            Grid.SetColumn(spPort, 2);
            hostPortGrid.Children.Add(spPort);

            sp.Children.Add(hostPortGrid);

            sp.Children.Add(UiTheme.CreateText("Minecraft Sürümü", 12, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 10, 0, 4)));
            string[] versions = new string[] { "auto", "1.21.1", "1.20.4", "1.20.1", "1.19.4", "1.18.2", "1.16.5", "1.12.2", "1.8.9", "custom" };
            cmbVersion = UiTheme.CreateComboBox(versions, 0);
            txtCustomVersion = UiTheme.CreateInput("", "Örn: 1.20.2");
            txtCustomVersion.Margin = new Thickness(0, 6, 0, 0);
            txtCustomVersion.Visibility = Visibility.Collapsed;

            string curVer = existingSrv != null ? JsonHelper.Str(existingSrv, "version", "") : "";
            if (string.IsNullOrEmpty(curVer) || curVer == "false" || curVer == "auto")
            {
                cmbVersion.SelectedIndex = 0;
            }
            else
            {
                int idx = Array.IndexOf(versions, curVer);
                if (idx >= 0) cmbVersion.SelectedIndex = idx;
                else
                {
                    cmbVersion.SelectedIndex = versions.Length - 1;
                    txtCustomVersion.Text = curVer;
                    txtCustomVersion.Visibility = Visibility.Visible;
                }
            }

            cmbVersion.SelectionChanged += delegate
            {
                string sel = cmbVersion.SelectedItem != null ? cmbVersion.SelectedItem.ToString() : "auto";
                txtCustomVersion.Visibility = sel == "custom" ? Visibility.Visible : Visibility.Collapsed;
            };

            sp.Children.Add(cmbVersion);
            sp.Children.Add(txtCustomVersion);

            StackPanel footer = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 18, 0, 0) };
            footer.Children.Add(UiTheme.CreateButton("İptal", "outline", delegate { Close(); }));
            footer.Children.Add(UiTheme.CreateButton("💾 Kaydet ve Seç", "primary", OnSaveClick));
            sp.Children.Add(footer);

            card.Child = sp;
            Content = card;
        }

        private void OnSaveClick(object sender, RoutedEventArgs e)
        {
            string host = txtHost.Text.Trim();
            if (string.IsNullOrEmpty(host))
            {
                MessageBox.Show("Lütfen sunucu IP/domain adresini girin.", "SCT AFK Service", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }
            string name = txtName.Text.Trim();
            if (string.IsNullOrEmpty(name)) name = host;
            int port;
            if (!int.TryParse(txtPort.Text.Trim(), out port) || port <= 0) port = 25565;

            string verSel = cmbVersion.SelectedItem != null ? cmbVersion.SelectedItem.ToString() : "auto";
            object finalVer = false;
            if (verSel == "custom")
            {
                string cv = txtCustomVersion.Text.Trim();
                if (!string.IsNullOrEmpty(cv)) finalVer = cv;
            }
            else if (verSel != "auto")
            {
                finalVer = verSel;
            }

            Dictionary<string, object> payload = new Dictionary<string, object>();
            payload["name"] = name;
            payload["host"] = host;
            payload["port"] = port;
            payload["version"] = finalVer;

            string method = string.IsNullOrEmpty(editServerId) ? "POST" : "PUT";
            string url = string.IsNullOrEmpty(editServerId) ? "/api/servers" : ("/api/servers/" + editServerId);

            pipe.SendApiAsync(method, url, payload, delegate
            {
                if (onSaved != null) onSaved();
                Close();
            });
        }
    }

    public class AccountModal : Window
    {
        private readonly SctPipeClient pipe;
        private readonly string editAccountId;
        private readonly Action<string> onSaved;
        private TextBox txtUsername;
        private TextBox txtPassword;
        private TextBox txtEmail;
        private TextBox txtJoinCmds;
        private ComboBox cmbProxyType;
        private TextBox txtProxy;
        private ComboBox cmbBrand;
        private ComboBox cmbLocale;
        private CheckBox chkAntiAfk;
        private CheckBox chkAutoReconnect;

        public AccountModal(Window owner, SctPipeClient pipeClient, Dictionary<string, object> existingAcc, Action<string> onSavedCallback)
        {
            Owner = owner;
            pipe = pipeClient;
            onSaved = onSavedCallback;
            editAccountId = existingAcc != null ? JsonHelper.Str(existingAcc, "id", "") : "";

            Title = string.IsNullOrEmpty(editAccountId) ? "Yeni Hesap Ekle" : "Hesabı Düzenle";
            Width = 520;
            Height = 490;
            WindowStartupLocation = WindowStartupLocation.CenterOwner;
            Background = UiTheme.BgBase;
            Foreground = UiTheme.TextMain;
            ResizeMode = ResizeMode.NoResize;

            Border card = UiTheme.CreateCard(new Thickness(18), new Thickness(10));
            StackPanel sp = new StackPanel();

            sp.Children.Add(UiTheme.CreateText(Title, 15, FontWeights.ExtraBold, UiTheme.AccentWhite, new Thickness(0, 0, 0, 10)));

            sp.Children.Add(UiTheme.CreateText("Kullanıcı Adı (Oyun İçi İsim)", 12, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 2, 0, 4)));
            txtUsername = UiTheme.CreateInput(existingAcc != null ? JsonHelper.Str(existingAcc, "username", "") : "", "Örn: AFK_Hesap1");
            sp.Children.Add(txtUsername);

            Grid passEmailGrid = new Grid { Margin = new Thickness(0, 8, 0, 0) };
            passEmailGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            passEmailGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
            passEmailGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            StackPanel spPass = new StackPanel();
            spPass.Children.Add(UiTheme.CreateText("Sunucu Şifresi (/login & /register)", 12, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 0, 0, 4)));
            txtPassword = UiTheme.CreateInput(existingAcc != null ? JsonHelper.Str(existingAcc, "password", "") : "", "Sunucu şifresi");
            spPass.Children.Add(txtPassword);
            Grid.SetColumn(spPass, 0);
            passEmailGrid.Children.Add(spPass);

            StackPanel spEmail = new StackPanel();
            spEmail.Children.Add(UiTheme.CreateText("E-Posta Adresi (/register için)", 12, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 0, 0, 4)));
            txtEmail = UiTheme.CreateInput(existingAcc != null ? JsonHelper.Str(existingAcc, "email", "") : "", "ornek@gmail.com");
            spEmail.Children.Add(txtEmail);
            Grid.SetColumn(spEmail, 2);
            passEmailGrid.Children.Add(spEmail);
            sp.Children.Add(passEmailGrid);

            sp.Children.Add(UiTheme.CreateText("Giriş Sonrası Özel Komutlar (Virgülle ayırın)", 12, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 8, 0, 4)));
            List<object> joinList = existingAcc != null ? JsonHelper.Arr(existingAcc, "customJoinCommands") : new List<object>();
            List<string> joinStrs = new List<string>();
            for (int i = 0; i < joinList.Count; i++) if (joinList[i] != null) joinStrs.Add(joinList[i].ToString());
            txtJoinCmds = UiTheme.CreateInput(string.Join(", ", joinStrs.ToArray()), "/server skyblock, /is go");
            sp.Children.Add(txtJoinCmds);

            Grid proxyGrid = new Grid { Margin = new Thickness(0, 8, 0, 0) };
            proxyGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            proxyGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
            proxyGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });

            StackPanel spPType = new StackPanel();
            spPType.Children.Add(UiTheme.CreateText("Proxy Türü", 12, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 0, 0, 4)));
            string[] pTypes = new string[] { "none", "socks5", "socks4", "http" };
            cmbProxyType = UiTheme.CreateComboBox(pTypes, 0);
            string curPType = existingAcc != null ? JsonHelper.Str(existingAcc, "proxyType", "none") : "none";
            int pIdx = Array.IndexOf(pTypes, curPType);
            if (pIdx >= 0) cmbProxyType.SelectedIndex = pIdx;
            spPType.Children.Add(cmbProxyType);
            Grid.SetColumn(spPType, 0);
            proxyGrid.Children.Add(spPType);

            StackPanel spPVal = new StackPanel();
            spPVal.Children.Add(UiTheme.CreateText("Proxy Adresi (ip:port:user:pass)", 12, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 0, 0, 4)));
            txtProxy = UiTheme.CreateInput(existingAcc != null ? JsonHelper.Str(existingAcc, "proxy", "") : "", "185.122.45.10:1080:user:pass");
            spPVal.Children.Add(txtProxy);
            Grid.SetColumn(spPVal, 2);
            proxyGrid.Children.Add(spPVal);
            sp.Children.Add(proxyGrid);

            Grid brandGrid = new Grid { Margin = new Thickness(0, 8, 0, 0) };
            brandGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            brandGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
            brandGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            StackPanel spBrand = new StackPanel();
            spBrand.Children.Add(UiTheme.CreateText("İstemci Kimliği (Brand Spoof)", 12, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 0, 0, 4)));
            string[] brands = new string[] { "vanilla", "lunar", "feather", "fabric", "forge", "badlion", "optifine" };
            cmbBrand = UiTheme.CreateComboBox(brands, 0);
            string curBrand = existingAcc != null ? JsonHelper.Str(existingAcc, "clientBrand", "vanilla") : "vanilla";
            int bIdx = Array.IndexOf(brands, curBrand);
            if (bIdx >= 0) cmbBrand.SelectedIndex = bIdx;
            spBrand.Children.Add(cmbBrand);
            Grid.SetColumn(spBrand, 0);
            brandGrid.Children.Add(spBrand);

            StackPanel spLoc = new StackPanel();
            spLoc.Children.Add(UiTheme.CreateText("İstemci Dili (Locale)", 12, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 0, 0, 4)));
            string[] locales = new string[] { "tr_TR", "en_US", "en_GB", "de_DE" };
            cmbLocale = UiTheme.CreateComboBox(locales, 0);
            string curLoc = existingAcc != null ? JsonHelper.Str(existingAcc, "clientLocale", "tr_TR") : "tr_TR";
            int lIdx = Array.IndexOf(locales, curLoc);
            if (lIdx >= 0) cmbLocale.SelectedIndex = lIdx;
            spLoc.Children.Add(cmbLocale);
            Grid.SetColumn(spLoc, 2);
            brandGrid.Children.Add(spLoc);
            sp.Children.Add(brandGrid);

            StackPanel spFlags = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 12, 0, 0) };
            chkAntiAfk = UiTheme.CreateCheckBox("Anti-AFK Açık", existingAcc == null || JsonHelper.Bool(existingAcc, "antiAfk", true));
            chkAutoReconnect = UiTheme.CreateCheckBox("Otomatik Yeniden Bağlanma Açık", existingAcc == null || JsonHelper.Bool(existingAcc, "autoReconnect", true));
            spFlags.Children.Add(chkAntiAfk);
            spFlags.Children.Add(chkAutoReconnect);
            sp.Children.Add(spFlags);

            StackPanel footer = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 16, 0, 0) };
            footer.Children.Add(UiTheme.CreateButton("İptal", "outline", delegate { Close(); }));
            footer.Children.Add(UiTheme.CreateButton("💾 Kaydet", "primary", OnSaveClick));
            sp.Children.Add(footer);

            card.Child = sp;
            Content = card;
        }

        private void OnSaveClick(object sender, RoutedEventArgs e)
        {
            string username = txtUsername.Text.Trim();
            if (string.IsNullOrEmpty(username))
            {
                MessageBox.Show("Lütfen hesap kullanıcı adını girin.", "SCT AFK Service", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            string proxyVal = txtProxy.Text.Trim();
            string proxyTypeVal = cmbProxyType.SelectedItem != null ? cmbProxyType.SelectedItem.ToString() : "none";
            if (!string.IsNullOrEmpty(proxyVal) && proxyTypeVal == "none") proxyTypeVal = "socks5";

            string[] rawCmds = txtJoinCmds.Text.Split(new char[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
            List<string> joinCmds = new List<string>();
            for (int i = 0; i < rawCmds.Length; i++)
            {
                string c = rawCmds[i].Trim();
                if (!string.IsNullOrEmpty(c)) joinCmds.Add(c);
            }

            Dictionary<string, object> payload = new Dictionary<string, object>();
            payload["username"] = username;
            payload["password"] = txtPassword.Text;
            payload["email"] = txtEmail.Text.Trim();
            payload["proxyType"] = proxyTypeVal;
            payload["proxy"] = proxyVal;
            payload["clientBrand"] = cmbBrand.SelectedItem != null ? cmbBrand.SelectedItem.ToString() : "vanilla";
            payload["clientLocale"] = cmbLocale.SelectedItem != null ? cmbLocale.SelectedItem.ToString() : "tr_TR";
            payload["customJoinCommands"] = joinCmds.ToArray();
            payload["antiAfk"] = chkAntiAfk.IsChecked == true;
            payload["autoReconnect"] = chkAutoReconnect.IsChecked == true;

            string method = string.IsNullOrEmpty(editAccountId) ? "POST" : "PUT";
            string url = string.IsNullOrEmpty(editAccountId) ? "/api/accounts" : ("/api/accounts/" + editAccountId);

            pipe.SendApiAsync(method, url, payload, delegate(int status, Dictionary<string, object> data)
            {
                string err = JsonHelper.Str(data, "error", "");
                if (!string.IsNullOrEmpty(err))
                {
                    MessageBox.Show(err, "SCT AFK Service", MessageBoxButton.OK, MessageBoxImage.Warning);
                    return;
                }
                string savedId = JsonHelper.Str(data, "id", editAccountId);
                if (onSaved != null) onSaved(savedId);
                Close();
            });
        }
    }

    public class ProxyPoolModal : Window
    {
        private readonly SctPipeClient pipe;
        private readonly Action onCompleted;
        private ComboBox cmbProxyType;
        private TextBox txtProxyList;

        public ProxyPoolModal(Window owner, SctPipeClient pipeClient, List<string> currentProxies, Action onCompletedCallback)
        {
            Owner = owner;
            pipe = pipeClient;
            onCompleted = onCompletedCallback;

            Title = "Toplu Proxy Havuzu & Otomatik Dağıtıcı";
            Width = 500;
            Height = 430;
            WindowStartupLocation = WindowStartupLocation.CenterOwner;
            Background = UiTheme.BgBase;
            Foreground = UiTheme.TextMain;
            ResizeMode = ResizeMode.NoResize;

            Border card = UiTheme.CreateCard(new Thickness(18), new Thickness(10));
            StackPanel sp = new StackPanel();

            sp.Children.Add(UiTheme.CreateText("🌐 Toplu Proxy Havuzu & Otomatik Dağıtıcı", 15, FontWeights.ExtraBold, UiTheme.AccentWhite, new Thickness(0, 0, 0, 8)));
            sp.Children.Add(UiTheme.CreateText("Listedeki proxyler sol menüdeki hesaplarınıza sırayla (1 hesaba 1 farklı IP düşecek şekilde) otomatik atanır.", 12, FontWeights.Normal, UiTheme.TextMuted, new Thickness(0, 0, 0, 10)));

            sp.Children.Add(UiTheme.CreateText("Proxy Türü", 12, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 0, 0, 4)));
            cmbProxyType = UiTheme.CreateComboBox(new string[] { "socks5", "socks4", "http" }, 0);
            sp.Children.Add(cmbProxyType);

            sp.Children.Add(UiTheme.CreateText("Proxy Listesi (Her satıra 1 adet: ip:port veya ip:port:user:pass)", 12, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 10, 0, 4)));
            txtProxyList = new TextBox
            {
                Text = currentProxies != null && currentProxies.Count > 0 ? string.Join(Environment.NewLine, currentProxies.ToArray()) : "",
                Background = UiTheme.BgInput,
                Foreground = UiTheme.TextMain,
                CaretBrush = UiTheme.AccentWhite,
                BorderBrush = UiTheme.BorderBrush,
                BorderThickness = new Thickness(1),
                Padding = new Thickness(8),
                FontFamily = new FontFamily("Consolas"),
                FontSize = 12.5,
                AcceptsReturn = true,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                Height = 160
            };
            sp.Children.Add(txtProxyList);

            DockPanel footer = new DockPanel { Margin = new Thickness(0, 14, 0, 0) };
            Button btnClear = UiTheme.CreateButton("🗑️ Tüm Proxyleri Temizle", "danger", OnClearAllClick);
            DockPanel.SetDock(btnClear, Dock.Left);
            footer.Children.Add(btnClear);

            StackPanel rightBtns = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
            rightBtns.Children.Add(UiTheme.CreateButton("İptal", "outline", delegate { Close(); }));
            rightBtns.Children.Add(UiTheme.CreateButton("⚡ Hesaplara Dağıt", "primary", OnDistributeClick));
            footer.Children.Add(rightBtns);

            sp.Children.Add(footer);
            card.Child = sp;
            Content = card;
        }

        private void OnClearAllClick(object sender, RoutedEventArgs e)
        {
            if (MessageBox.Show("Tüm hesaplardaki proxy ayarları kaldırılıp kendi IP adresinize dönülsün mü?", "Proxyleri Sıfırla", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
                return;

            Dictionary<string, object> body = new Dictionary<string, object>();
            body["action"] = "clearAll";
            pipe.SendApiAsync("POST", "/api/proxies/clear-all", body, delegate(int st, Dictionary<string, object> d)
            {
                pipe.SendApiAsync("POST", "/api/proxies/assign", body, delegate
                {
                    if (onCompleted != null) onCompleted();
                    Close();
                });
            });
        }

        private void OnDistributeClick(object sender, RoutedEventArgs e)
        {
            string[] rawLines = txtProxyList.Text.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            List<string> proxies = new List<string>();
            for (int i = 0; i < rawLines.Length; i++)
            {
                string line = rawLines[i].Trim();
                if (!string.IsNullOrEmpty(line)) proxies.Add(line);
            }

            if (proxies.Count == 0)
            {
                MessageBox.Show("Lütfen en az 1 adet proxy adresi girin.", "SCT AFK Service", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            string pType = cmbProxyType.SelectedItem != null ? cmbProxyType.SelectedItem.ToString() : "socks5";
            Dictionary<string, object> body = new Dictionary<string, object>();
            body["proxyType"] = pType;
            body["proxies"] = proxies.ToArray();

            pipe.SendApiAsync("POST", "/api/proxies/distribute", body, delegate(int st, Dictionary<string, object> d)
            {
                if (st >= 400 || JsonHelper.Str(d, "error", "") != "")
                {
                    pipe.SendApiAsync("POST", "/api/proxies/assign", body, delegate
                    {
                        if (onCompleted != null) onCompleted();
                        Close();
                    });
                }
                else
                {
                    if (onCompleted != null) onCompleted();
                    Close();
                }
            });
        }
    }

    public class AdminBroadcastModal : Window
    {
        public AdminBroadcastModal(Window owner, string title, string message)
        {
            if (owner != null && owner.IsVisible) Owner = owner;
            Title = string.IsNullOrEmpty(title) ? "YÖNETİCİ BİLDİRİMİ" : title;
            Width = 480;
            Height = 290;
            WindowStartupLocation = owner != null && owner.IsVisible ? WindowStartupLocation.CenterOwner : WindowStartupLocation.CenterScreen;
            Background = UiTheme.BgBase;
            Foreground = UiTheme.TextMain;
            ResizeMode = ResizeMode.NoResize;
            Topmost = true;

            Border card = new Border
            {
                Background = UiTheme.BgSidebar,
                BorderBrush = UiTheme.Indigo,
                BorderThickness = new Thickness(2),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(18),
                Margin = new Thickness(10)
            };

            DockPanel dp = new DockPanel();

            StackPanel header = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 12) };
            header.Children.Add(UiTheme.CreateText("📢 " + Title, 16, FontWeights.ExtraBold, UiTheme.AccentWhite));
            DockPanel.SetDock(header, Dock.Top);
            dp.Children.Add(header);

            StackPanel footer = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 12, 0, 0) };
            footer.Children.Add(UiTheme.CreateText("● Doğrulanmış Sistem Mesajı (" + DateTime.Now.ToString("HH:mm:ss") + ")   ", 11, FontWeights.SemiBold, UiTheme.Green));
            footer.Children.Add(UiTheme.CreateButton("Tamam, Anladım", "primary", delegate { Close(); }));
            DockPanel.SetDock(footer, Dock.Bottom);
            dp.Children.Add(footer);

            ScrollViewer sv = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
            sv.Content = UiTheme.CreateText(message ?? "", 13.5, FontWeights.Medium, UiTheme.TextMain);
            dp.Children.Add(sv);

            card.Child = dp;
            Content = card;
        }
    }

    // =========================================================================
    // MAIN NATIVE WPF DESKTOP WINDOW (SctMainWindow)
    // =========================================================================
    public class SctMainWindow : Window
    {
        private readonly string runtimeDir;
        private readonly SctPipeClient pipe;
        private readonly Action onMinimizeToTray;
        private readonly Action onRequestExitApp;
        private bool allowRealClose = false;

        private Dictionary<string, object> appState = new Dictionary<string, object>();
        private readonly List<Dictionary<string, object>> logs = new List<Dictionary<string, object>>();
        private string selectedAccountId = null;
        private int activeTabIndex = 0;
        private DispatcherTimer radarTimer;
        private DispatcherTimer uptimeTimer;

        // TopBar & Banners
        private TextBlock lblTopServerBadge;
        private TextBlock lblTopOnlineBadge;
        private Border bannerHotUpdate;
        private TextBlock lblHotUpdateInfo;
        private Border overlayReconnect;
        private TextBlock lblReconnectStatus;
        private Border bannerToast;
        private TextBlock lblToastText;
        private DispatcherTimer toastTimer;

        // Left Sidebar - KeyAuth
        private Border badgeKaPlan;
        private TextBlock lblKaPlanText;
        private TextBlock lblKaUser;
        private TextBlock lblKaExpiry;
        private Button btnKaLogout;
        // Left Sidebar - Lists
        private StackPanel panelServerList;
        private TextBlock lblServerCount;
        private StackPanel panelAccountList;
        private Border borderInspAvatar;
        private Border heldItemCard;
        private Border heldItemSlotBorder;
        private TextBlock lblHeldItemName;
        private TextBlock lblHeldItemDurability;
        private UniformGrid gridMainInv;
        private UniformGrid gridHotbar;
        private UniformGrid gridOpenWinSlots;
        private TextBlock lblAccountCount;

        // Inspector Header
        private TextBlock lblInspUsername;
        private TextBlock lblInspSub;
        private Border badgeInspStatus;
        private TextBlock lblInspStatusText;
        private TextBlock lblInspHealthFood;
        private TextBlock lblInspPos;
        private TextBlock lblInspUptimePing;

        // Tab buttons & containers
        private readonly List<Button> tabButtons = new List<Button>();
        private readonly List<UIElement> tabPanes = new List<UIElement>();
        private Border proLockOverlay;
        private TextBlock lblProLockTitle;

        // Tab 1: Konsol
        private TextBlock lblChatBalance;
        private CheckBox chkShowAllLogs;
        private StackPanel panelLogLines;
        private ScrollViewer scrollLogs;
        private ComboBox cmbChatTarget;
        private TextBox txtChatInput;
        private TextBlock lblSbTitle;
        private TextBlock lblSbMeta;
        private StackPanel panelSbLines;
        private TextBlock lblOnlinePlayersCount;
        private StackPanel panelOnlinePlayers;

        // Tab 2: Envanter & Menü
        private TextBlock lblOpenWinTitle;
        private TextBlock lblOpenWinSlots;
        private WrapPanel wrapOpenWinSlots;
        private TextBlock lblHeldItemBadge;
        private WrapPanel wrapBotInvSlots;

        // Tab 3: Farm & Eylemler
        private TextBlock lblFarmCounters;
        private readonly Dictionary<string, Button> autoModeToggleBtns = new Dictionary<string, Button>();
        private Button btnSpawnerNow;
        private Button btnJackNow;
        private readonly Dictionary<string, CheckBox> botRuleChecks = new Dictionary<string, CheckBox>();
        private bool isUpdatingBotRuleChecks = false;
        private TextBox txtAdvRepairCmd;
        private TextBox txtAdvRepairPct;
        private TextBox txtAdvFarmerSec;
        private TextBox txtAdvMinerSec;
        private TextBox txtAdvSpawnerSec;
        private TextBox txtAdvSpawnerCount;
        private TextBox txtAdvSpawnerCoords;
        private TextBox txtJackInterval;
        private TextBox txtJackBatch;
        private TextBox txtJackPumpkinChest;
        private TextBox txtJackTorchChest;
        private TextBox txtJackOutputChest;
        private TextBox txtJackIronChest;
        private TextBox txtJackStickChest;
        private TextBox txtJackCarveSpot;

        // Tab 4: Oto-İnşa (PRO)
        private TextBlock lblBuilderSchemInfo;
        private ComboBox cmbBuilderRotation;
        private TextBox txtBuilderDelay;
        private TextBox txtBuilderOx;
        private TextBox txtBuilderOy;
        private TextBox txtBuilderOz;
        private TextBox txtBuilderP1x;
        private TextBox txtBuilderP1y;
        private TextBox txtBuilderP1z;
        private TextBox txtBuilderP2x;
        private TextBox txtBuilderP2y;
        private TextBox txtBuilderP2z;
        private TextBox txtBuilderFillBlock;
        private ComboBox cmbBuilderFillMode;
        private ComboBox cmbBuilderSavedPresets;
        private readonly List<string> builderPresetIds = new List<string>();
        private CheckBox chkBuilderMove;
        private CheckBox chkBuilderClear;
        private CheckBox chkBuilderSkip;
        private CheckBox chkBuilderRestock;
        private Button btnBuilderPause;
        private Button btnBuilderChain;
        private Button btnBuilderCoop;
        private ProgressBar progBuilder;
        private TextBlock lblBuilderProgress;
        private TextBlock lblBuilderStatusMsg;
        private Canvas canvasBuilderPreview;
        private StackPanel panelBuilderBom;
        private Dictionary<string, object> lastBuilderPreviewData = null;

        // Tab 5: Koruma (PRO)
        private CheckBox chkDefAutoEat;
        private TextBox txtDefFoodThreshold;
        private CheckBox chkDefPanic;
        private TextBox txtDefPanicHp;
        private CheckBox chkDefSafeRecovery;
        private CheckBox chkDefAutoCmd;
        private TextBox txtDefAutoCmdText;
        private TextBox txtDefAutoCmdSec;
        private TextBox txtDefJoinCmds;
        private ComboBox cmbDefBrand;
        private TextBox txtDefCustomBrand;
        private ComboBox cmbDefLocale;
        private TextBox txtDefViewDist;
        private ComboBox cmbDefMainHand;
        private TextBox txtDefHwid;

        // Tab 6: Radar & Hareket (PRO)
        private string radarViewMode = "2d";
        private Slider sliderRadarRadius;
        private TextBlock lblRadarRadiusVal;
        private ComboBox cmbRadarSliceMode;
        private Canvas canvasRadar;
        private TextBlock lblRadarHover;
        private StackPanel panelRadarEntities;
        private Dictionary<string, object> lastRadarSnapshot = null;
        private class RadarHitCell
        {
            public double X1, Y1, X2, Y2;
            public int Wx, Wy, Wz;
            public string BlockName;
        }
        private readonly List<RadarHitCell> radarHitCells = new List<RadarHitCell>();

        // Tab 7: Genel Ayarlar (9 Categories)
        private TextBox txtSetHost;
        private TextBox txtSetPort;
        private ComboBox cmbSetVersion;
        private TextBox txtSetCustomVer;
        private CheckBox chkSetAuthEnabled;
        private CheckBox chkSetAuthSmart;
        private TextBox txtSetAuthDelay;
        private TextBox txtSetLoginCmd;
        private TextBox txtSetRegCmd;
        private CheckBox chkSetAfkEnabled;
        private TextBox txtSetAfkSec;
        private CheckBox chkSetRecEnabled;
        private TextBox txtSetRecSec;
        private CheckBox chkSetWebhookEnabled;
        private TextBox txtSetWebhookUrl;
        private CheckBox chkSetWhDisconnect;
        private CheckBox chkSetWhPanic;
        private CheckBox chkSetWhDeath;
        private CheckBox chkSetWhCaptcha;
        private CheckBox chkSetSoundEnabled;
        private ComboBox cmbSetSoundTheme;
        private Slider sliderSetSoundVol;
        private TextBlock lblSetSoundVol;
        private ComboBox cmbSetSoundTestType;
        private CheckBox chkSetSndDamage;
        private CheckBox chkSetSndDisconnect;
        private CheckBox chkSetSndMention;
        private CheckBox chkSetSndCaptcha;
        private CheckBox chkSetSndNotify;
        private CheckBox chkSetDeskEnabled;
        private CheckBox chkSetDeskMention;
        private CheckBox chkSetDeskDisconnect;
        private CheckBox chkSetDeskDeath;
        private CheckBox chkSetDeskCaptcha;
        private CheckBox chkSetRpcEnabled;
        private CheckBox chkSetRpcServer;
        private CheckBox chkSetRpcMode;
        private CheckBox chkSetRpcStats;
        private CheckBox chkSetRpcCrops;
        private CheckBox chkSetRpcMobs;
        private CheckBox chkSetRpcChests;
        private CheckBox chkSetRpcCaptchas;
        private CheckBox chkSetRpcBuilder;
        private CheckBox chkSetRpcHealth;
        private CheckBox chkSetRpcPing;
        private CheckBox chkSetRpcCoords;
        private CheckBox chkSetRpcAccount;
        private CheckBox chkSetRpcAvatar;
        private CheckBox chkSetRpcTime;
        private TextBox txtSetRpcDetails;
        private TextBox txtSetRpcState;
        private TextBox txtSetRpcClientId;
        private TextBox txtSetRpcImage;
        private TextBox txtSetRpcBtn1Label;
        private TextBox txtSetRpcBtn1Url;
        private TextBox txtSetRpcBtn2Label;
        private TextBox txtSetRpcBtn2Url;
        private CheckBox chkSetCoopEnabled;
        private CheckBox chkSetCoopBuilder;
        private CheckBox chkSetCoopTill;
        private CheckBox chkSetCoopPlant;
        private CheckBox chkSetCoopChest;
        private TextBlock lblSetUpdateCurBuild;
        private TextBlock lblSetUpdateStatus;
        private TextBox txtSetRepoOwner;
        private TextBox txtSetRepoName;
        private TextBox txtSetRepoBranch;
        private CheckBox chkSetUpdateAutoApply;

        public SctMainWindow(string runtimeDirectory, SctPipeClient pipeClient, Action onMinimizeTray, Action onExitApp)
        {
            runtimeDir = runtimeDirectory;
            pipe = pipeClient;
            onMinimizeToTray = onMinimizeTray;
            onRequestExitApp = onExitApp;

            Title = "SCT AFK Service - Çoklu Minecraft Hesap & Otomasyon Kontrol Paneli";
            Width = 1320;
            Height = 830;
            MinWidth = 1040;
            MinHeight = 680;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            Background = UiTheme.BgBase;
            Foreground = UiTheme.TextMain;

            TryLoadWindowIcon();
            BuildMainLayout();
            PreloadLocalDiskState();

            pipe.OnConnectionChanged += OnPipeConnectionChanged;
            pipe.OnServerEvent += OnPipeServerEvent;

            radarTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(1200) };
            radarTimer.Tick += delegate
            {
                if (!IsVisible) return;
                if (activeTabIndex == 5 && IsProUser())
                {
                    FetchRadarSnapshot();
                }
                else if (activeTabIndex == 3 && IsProUser())
                {
                    Dictionary<string, object> bot = GetSelectedBot();
                    Dictionary<string, object> bld = JsonHelper.SubDict(bot, "builder");
                    if (JsonHelper.Str(bld, "status", "") == "building")
                    {
                        FetchBuilderPreview();
                    }
                }
            };
            radarTimer.Start();

            uptimeTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            uptimeTimer.Tick += delegate
            {
                if (IsVisible) UpdateLiveCountersAndUptime();
            };
            uptimeTimer.Start();

            Loaded += delegate
            {
                LoadInitialState(false);
            };
        }

        public void PrepareForExit()
        {
            allowRealClose = true;
        }

        protected override void OnClosing(System.ComponentModel.CancelEventArgs e)
        {
            if (!allowRealClose)
            {
                e.Cancel = true;
                Hide();
                if (onMinimizeToTray != null) onMinimizeToTray();
                return;
            }
            base.OnClosing(e);
        }

        private void TryLoadWindowIcon()
        {
            try
            {
                string icoPath = System.IO.Path.Combine(runtimeDir, "app.ico");
                if (File.Exists(icoPath))
                {
                    Uri uri = new Uri(icoPath, UriKind.Absolute);
                    Icon = BitmapFrame.Create(uri);
                }
            }
            catch { }
        }

        private Border CreateRoundLogo(double size)
        {
            Border b = new Border
            {
                Width = size,
                Height = size,
                CornerRadius = new CornerRadius(size / 2.0),
                BorderBrush = UiTheme.BorderLight,
                BorderThickness = new Thickness(1.5),
                Margin = new Thickness(0, 0, 12, 0),
                ClipToBounds = true,
                Background = UiTheme.SandBeige
            };
            try
            {
                string logoPath = System.IO.Path.Combine(runtimeDir, "public", "logo.jpg");
                if (!File.Exists(logoPath)) logoPath = System.IO.Path.Combine(runtimeDir, "app.ico");
                if (File.Exists(logoPath))
                {
                    BitmapImage bmp = new BitmapImage();
                    bmp.BeginInit();
                    bmp.CacheOption = BitmapCacheOption.OnLoad;
                    bmp.UriSource = new Uri(logoPath, UriKind.Absolute);
                    bmp.EndInit();

                    ImageBrush ib = new ImageBrush(bmp)
                    {
                        Stretch = Stretch.UniformToFill,
                        AlignmentX = AlignmentX.Center,
                        AlignmentY = AlignmentY.Center
                    };
                    b.Background = ib;
                }
            }
            catch { }
            return b;
        }

        public void ShowToast(string message, string type = "info")
        {
            if (bannerToast == null || lblToastText == null) return;
            lblToastText.Text = message ?? "";
            if (type == "error")
            {
                bannerToast.Background = UiTheme.RedBg;
                bannerToast.BorderBrush = UiTheme.Red;
                lblToastText.Foreground = UiTheme.Red;
            }
            else if (type == "success")
            {
                bannerToast.Background = UiTheme.GreenBg;
                bannerToast.BorderBrush = UiTheme.Green;
                lblToastText.Foreground = UiTheme.Green;
            }
            else
            {
                bannerToast.Background = UiTheme.IndigoBg;
                bannerToast.BorderBrush = UiTheme.Indigo;
                lblToastText.Foreground = UiTheme.AccentWhite;
            }
            bannerToast.Visibility = Visibility.Visible;

            if (toastTimer == null)
            {
                toastTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(3800) };
                toastTimer.Tick += delegate
                {
                    toastTimer.Stop();
                    bannerToast.Visibility = Visibility.Collapsed;
                };
            }
            toastTimer.Stop();
            toastTimer.Start();
        }

        private void BuildMainLayout()
        {
            Grid rootGrid = new Grid { Background = UiTheme.BgBase };

            DockPanel mainDock = new DockPanel { LastChildFill = true };

            // 1. TOP BAR (Warm Ivory Editorial Header)
            Border topBar = new Border
            {
                Background = UiTheme.BgCard,
                BorderBrush = UiTheme.BorderBrush,
                BorderThickness = new Thickness(0, 0, 0, 1),
                Padding = new Thickness(18, 11, 18, 11)
            };
            DockPanel topDock = new DockPanel();

            StackPanel brandPanel = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            Border logoBorder = CreateRoundLogo(40);
            brandPanel.Children.Add(logoBorder);

            StackPanel titleStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            titleStack.Children.Add(UiTheme.CreateText("SCT AFK Service", 17, FontWeights.ExtraBold, UiTheme.ForestGreen));
            titleStack.Children.Add(UiTheme.CreateText("Çoklu Minecraft Hesap & Otomasyon Kontrol Paneli", 11.5, FontWeights.Medium, UiTheme.TextMuted));
            brandPanel.Children.Add(titleStack);
            DockPanel.SetDock(brandPanel, Dock.Left);
            topDock.Children.Add(brandPanel);

            StackPanel topRight = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center };

            Border srvPill = new Border
            {
                Background = UiTheme.IndigoBg,
                BorderBrush = UiTheme.ElectricPurpleBorder,
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(14),
                Padding = new Thickness(13, 5, 13, 5),
                Margin = new Thickness(0, 0, 8, 0)
            };
            lblTopServerBadge = UiTheme.CreateText("🌐 Sunucu: localhost:25565", 12, FontWeights.Bold, UiTheme.Indigo);
            srvPill.Child = lblTopServerBadge;
            topRight.Children.Add(srvPill);

            Border onlinePill = new Border
            {
                Background = UiTheme.GreenBg,
                BorderBrush = UiTheme.BrushHex("#A7F3D0"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(14),
                Padding = new Thickness(13, 5, 13, 5),
                Margin = new Thickness(0, 0, 10, 0)
            };
            lblTopOnlineBadge = UiTheme.CreateText("● 0 / 0 Bot Çevrimiçi", 12, FontWeights.Bold, UiTheme.Green);
            onlinePill.Child = lblTopOnlineBadge;
            topRight.Children.Add(onlinePill);

            topRight.Children.Add(UiTheme.CreateButton("🔄 Güncelleme Kontrol", "outline", OnCheckUpdateClick));
            topDock.Children.Add(topRight);
            topBar.Child = topDock;
            DockPanel.SetDock(topBar, Dock.Top);
            mainDock.Children.Add(topBar);

            // 2. CONDITIONAL HOT-UPDATE BANNER
            bannerHotUpdate = new Border
            {
                Background = UiTheme.IndigoBg,
                BorderBrush = UiTheme.Indigo,
                BorderThickness = new Thickness(0, 0, 0, 1),
                Padding = new Thickness(16, 8, 16, 8),
                Visibility = Visibility.Collapsed
            };
            DockPanel huDock = new DockPanel();
            lblHotUpdateInfo = UiTheme.CreateText("🚀 Yeni Güncelleme Mevcut!", 12.5, FontWeights.Bold, UiTheme.AccentWhite);
            DockPanel.SetDock(lblHotUpdateInfo, Dock.Left);
            huDock.Children.Add(lblHotUpdateInfo);
            StackPanel huBtns = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
            huBtns.Children.Add(UiTheme.CreateButton("⚡ Şimdi Güncelle", "primary", OnApplyUpdateClick));
            huBtns.Children.Add(UiTheme.CreateButton("✕", "outline", delegate { bannerHotUpdate.Visibility = Visibility.Collapsed; }));
            huDock.Children.Add(huBtns);
            bannerHotUpdate.Child = huDock;
            DockPanel.SetDock(bannerHotUpdate, Dock.Top);
            mainDock.Children.Add(bannerHotUpdate);

            // 3. LEFT SIDEBAR (310px width)
            Border sidebarBorder = new Border
            {
                Width = 310,
                Background = UiTheme.BgSidebar,
                BorderBrush = UiTheme.BorderBrush,
                BorderThickness = new Thickness(0, 0, 1.5, 0)
            };
            sidebarBorder.Child = BuildLeftSidebar();
            DockPanel.SetDock(sidebarBorder, Dock.Left);
            mainDock.Children.Add(sidebarBorder);

            // 4. MAIN CONTENT AREA (Inspector + 7 Tabs)
            mainDock.Children.Add(BuildRightMainArea());

            rootGrid.Children.Add(mainDock);

            // 5. TOAST BANNER (Floating bottom-right)
            bannerToast = new Border
            {
                Background = UiTheme.IndigoBg,
                BorderBrush = UiTheme.Indigo,
                BorderThickness = new Thickness(1.5),
                CornerRadius = new CornerRadius(8),
                Padding = new Thickness(14, 9, 14, 9),
                Margin = new Thickness(20),
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Bottom,
                Visibility = Visibility.Collapsed
            };
            lblToastText = UiTheme.CreateText("", 12.5, FontWeights.Bold, UiTheme.AccentWhite);
            bannerToast.Child = lblToastText;
            rootGrid.Children.Add(bannerToast);

            // 6. AUTO-RECONNECT OVERLAY (Shown when Named Pipe disconnects / Engine restarts)
            overlayReconnect = new Border
            {
                Background = UiTheme.BrushRgba(7, 7, 9, 232),
                Visibility = Visibility.Collapsed
            };
            Border reconCard = UiTheme.CreateCard(new Thickness(28, 22, 28, 22), new Thickness(0));
            reconCard.HorizontalAlignment = HorizontalAlignment.Center;
            reconCard.VerticalAlignment = VerticalAlignment.Center;
            reconCard.BorderBrush = UiTheme.Indigo;
            StackPanel reconStack = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center };
            reconStack.Children.Add(UiTheme.CreateText("⚡ SCT AFK Engine İle Bağlantı Kuruluyor...", 16, FontWeights.ExtraBold, UiTheme.AccentWhite, new Thickness(0, 0, 0, 6)));
            lblReconnectStatus = UiTheme.CreateText("Named Pipe (\\\\.\\pipe\\SctAfkEngineIpc) bekleniyor, hazır olduğunda otomatik bağlanacak...", 12.5, FontWeights.Normal, UiTheme.TextMuted);
            reconStack.Children.Add(lblReconnectStatus);
            reconCard.Child = reconStack;
            overlayReconnect.Child = reconCard;
            rootGrid.Children.Add(overlayReconnect);

            Content = rootGrid;
        }

        private UIElement BuildLeftSidebar()
        {
            Grid sideGrid = new Grid();
            sideGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // KeyAuth Card
            sideGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(195) }); // Servers Section
            sideGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); // Accounts Section

            // 1. KeyAuth License Hero Card (Editorial Accent Card)
            Border kaCard = new Border
            {
                Background = UiTheme.CreateHeroPurpleGradient(),
                BorderBrush = UiTheme.ElectricPurpleBorder,
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(16),
                Padding = new Thickness(14, 12, 14, 12),
                Margin = new Thickness(10, 10, 10, 6),
                Effect = UiTheme.CreateCardShadow()
            };
            StackPanel kaStack = new StackPanel();
            DockPanel kaTop = new DockPanel { Margin = new Thickness(0, 0, 0, 6) };
            badgeKaPlan = new Border
            {
                Background = UiTheme.ForestGreen,
                CornerRadius = new CornerRadius(8),
                Padding = new Thickness(9, 3, 9, 3),
                Margin = new Thickness(0, 0, 8, 0)
            };
            lblKaPlanText = UiTheme.CreateText("STARTER", 10.5, FontWeights.ExtraBold, UiTheme.PureWhite);
            badgeKaPlan.Child = lblKaPlanText;
            DockPanel.SetDock(badgeKaPlan, Dock.Left);
            kaTop.Children.Add(badgeKaPlan);

            lblKaExpiry = UiTheme.CreateText("Süresiz", 11, FontWeights.Bold, UiTheme.Indigo);
            lblKaExpiry.HorizontalAlignment = HorizontalAlignment.Right;
            kaTop.Children.Add(lblKaExpiry);
            kaStack.Children.Add(kaTop);

            lblKaUser = UiTheme.CreateText("Ücretsiz Sürüm", 15, FontWeights.ExtraBold, UiTheme.ForestGreen, new Thickness(0, 0, 0, 8));
            kaStack.Children.Add(lblKaUser);

            Grid kaBtnGrid = new Grid();
            kaBtnGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            kaBtnGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            Button btnManageKa = UiTheme.CreateButton("🔑 Lisans & Paket Yönetimi", "primary", delegate { OpenKeyAuthDialog(""); }, new Thickness(10, 6, 10, 6));
            Grid.SetColumn(btnManageKa, 0);
            kaBtnGrid.Children.Add(btnManageKa);

            btnKaLogout = UiTheme.CreateButton("Çıkış", "danger", OnKeyAuthLogoutClick, new Thickness(10, 6, 10, 6));
            btnKaLogout.Visibility = Visibility.Collapsed;
            Grid.SetColumn(btnKaLogout, 1);
            kaBtnGrid.Children.Add(btnKaLogout);
            kaStack.Children.Add(kaBtnGrid);
            kaCard.Child = kaStack;
            Grid.SetRow(kaCard, 0);
            sideGrid.Children.Add(kaCard);

            // 2. Sunucular (Servers) Section
            DockPanel srvSection = new DockPanel { Margin = new Thickness(0, 2, 0, 4) };
            Border srvHeader = new Border
            {
                BorderBrush = UiTheme.BorderBrush,
                BorderThickness = new Thickness(0, 1, 0, 1),
                Padding = new Thickness(12, 7, 12, 7)
            };
            DockPanel srvHeadDock = new DockPanel();
            StackPanel srvTitleLeft = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            srvTitleLeft.Children.Add(UiTheme.CreateText("SUNUCULAR ", 11.5, FontWeights.ExtraBold, UiTheme.AccentWhite));
            lblServerCount = UiTheme.CreateText("(0)", 11.5, FontWeights.Bold, UiTheme.TextMuted);
            srvTitleLeft.Children.Add(lblServerCount);
            DockPanel.SetDock(srvTitleLeft, Dock.Left);
            srvHeadDock.Children.Add(srvTitleLeft);

            Button btnAddSrv = UiTheme.CreateButton("+ Ekle", "primary", delegate { OpenServerDialog(null); }, new Thickness(8, 3, 8, 3));
            btnAddSrv.HorizontalAlignment = HorizontalAlignment.Right;
            srvHeadDock.Children.Add(btnAddSrv);
            srvHeader.Child = srvHeadDock;
            DockPanel.SetDock(srvHeader, Dock.Top);
            srvSection.Children.Add(srvHeader);

            ScrollViewer svServers = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Padding = new Thickness(10, 6, 10, 6) };
            panelServerList = new StackPanel();
            svServers.Content = panelServerList;
            srvSection.Children.Add(svServers);
            Grid.SetRow(srvSection, 1);
            sideGrid.Children.Add(srvSection);

            // 3. Hesaplar (Accounts) Section
            DockPanel accSection = new DockPanel();
            Border accHeader = new Border
            {
                BorderBrush = UiTheme.BorderBrush,
                BorderThickness = new Thickness(0, 1, 0, 1),
                Padding = new Thickness(12, 7, 12, 7)
            };
            StackPanel accHeadStack = new StackPanel();
            DockPanel accTopRow = new DockPanel { Margin = new Thickness(0, 0, 0, 6) };
            StackPanel accTitleLeft = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            accTitleLeft.Children.Add(UiTheme.CreateText("HESAPLAR ", 11.5, FontWeights.ExtraBold, UiTheme.AccentWhite));
            lblAccountCount = UiTheme.CreateText("(0)", 11.5, FontWeights.Bold, UiTheme.TextMuted);
            accTitleLeft.Children.Add(lblAccountCount);
            DockPanel.SetDock(accTitleLeft, Dock.Left);
            accTopRow.Children.Add(accTitleLeft);

            StackPanel accHeadBtns = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
            accHeadBtns.Children.Add(UiTheme.CreateButton("🌐 Proxy", "outline", OnOpenProxyPoolClick, new Thickness(8, 3, 8, 3)));
            accHeadBtns.Children.Add(UiTheme.CreateButton("+ Ekle", "primary", delegate { OpenAccountDialog(null); }, new Thickness(8, 3, 8, 3)));
            accTopRow.Children.Add(accHeadBtns);
            accHeadStack.Children.Add(accTopRow);

            UniformGrid bulkGrid = new UniformGrid { Columns = 2 };
            bulkGrid.Children.Add(UiTheme.CreateButton("▶ Tümünü Başlat", "success", OnStartAllAccountsClick, new Thickness(6, 5, 6, 5)));
            bulkGrid.Children.Add(UiTheme.CreateButton("⏹ Tümünü Durdur", "danger", OnStopAllAccountsClick, new Thickness(6, 5, 6, 5)));
            accHeadStack.Children.Add(bulkGrid);

            accHeader.Child = accHeadStack;
            DockPanel.SetDock(accHeader, Dock.Top);
            accSection.Children.Add(accHeader);

            ScrollViewer svAccounts = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Padding = new Thickness(10, 6, 10, 10) };
            panelAccountList = new StackPanel();
            svAccounts.Content = panelAccountList;
            accSection.Children.Add(svAccounts);
            Grid.SetRow(accSection, 2);
            sideGrid.Children.Add(accSection);

            return sideGrid;
        }

        private UIElement BuildRightMainArea()
        {
            DockPanel rightDock = new DockPanel { LastChildFill = true };

            // 1. Inspector Top Header (Floating Editorial Card)
            Border inspBorder = UiTheme.CreateCard(new Thickness(18, 13, 18, 13), new Thickness(14, 12, 14, 6));
            DockPanel inspDock = new DockPanel();

            StackPanel inspLeft = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            borderInspAvatar = new Border
            {
                Width = 44,
                Height = 44,
                CornerRadius = new CornerRadius(10),
                Background = UiTheme.BgInput,
                BorderBrush = UiTheme.BorderBrush,
                BorderThickness = new Thickness(1),
                ClipToBounds = true,
                Margin = new Thickness(0, 0, 14, 0),
                Child = CreateRoundLogo(44)
            };
            inspLeft.Children.Add(borderInspAvatar);

            StackPanel inspUserStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            StackPanel nameAndBadge = new StackPanel { Orientation = Orientation.Horizontal };
            lblInspUsername = UiTheme.CreateText("Hesap Seçilmedi", 17, FontWeights.ExtraBold, UiTheme.ForestGreen, new Thickness(0, 0, 8, 0));
            nameAndBadge.Children.Add(lblInspUsername);

            badgeInspStatus = new Border
            {
                Background = UiTheme.BgInput,
                BorderBrush = UiTheme.BorderBrush,
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(12),
                Padding = new Thickness(10, 3, 10, 3),
                VerticalAlignment = VerticalAlignment.Center
            };
            lblInspStatusText = UiTheme.CreateText("● Çevrimdışı", 11, FontWeights.Bold, UiTheme.TextMuted);
            badgeInspStatus.Child = lblInspStatusText;
            nameAndBadge.Children.Add(badgeInspStatus);
            inspUserStack.Children.Add(nameAndBadge);

            lblInspSub = UiTheme.CreateText("Sol menüden bir hesap seçin veya yeni hesap ekleyin", 11.5, FontWeights.Medium, UiTheme.TextMuted, new Thickness(0, 2, 0, 0));
            inspUserStack.Children.Add(lblInspSub);
            inspLeft.Children.Add(inspUserStack);
            DockPanel.SetDock(inspLeft, Dock.Left);
            inspDock.Children.Add(inspLeft);

            // Quick Buttons & Telemetry Pills on Right of Inspector
            StackPanel inspRight = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center };

            Border pillVitals = UiTheme.CreateSubCard(new Thickness(11, 6, 11, 6), new Thickness(0, 0, 6, 0));
            lblInspHealthFood = UiTheme.CreateText("❤ -/20  🍗 -/20", 12, FontWeights.Bold, UiTheme.ForestGreen);
            pillVitals.Child = lblInspHealthFood;
            inspRight.Children.Add(pillVitals);

            Border pillPos = UiTheme.CreateSubCard(new Thickness(11, 6, 11, 6), new Thickness(0, 0, 6, 0));
            lblInspPos = UiTheme.CreateText("📍 X:- Y:- Z:-", 12, FontWeights.Bold, UiTheme.ForestGreen);
            pillPos.Child = lblInspPos;
            inspRight.Children.Add(pillPos);

            Border pillTime = UiTheme.CreateSubCard(new Thickness(11, 6, 11, 6), new Thickness(0, 0, 10, 0));
            lblInspUptimePing = UiTheme.CreateText("⏱ 00:00:00 • - ms", 12, FontWeights.Bold, UiTheme.ForestGreen);
            pillTime.Child = lblInspUptimePing;
            inspRight.Children.Add(pillTime);

            inspRight.Children.Add(UiTheme.CreateButton("▶ Başlat", "success", delegate { SendSelectedBotAction("start", null); }));
            inspRight.Children.Add(UiTheme.CreateButton("⏹ Durdur", "danger", delegate { SendSelectedBotAction("stop", null); }));
            inspRight.Children.Add(UiTheme.CreateButton("🔄 Yeniden Bağlan", "outline", delegate { SendSelectedBotAction("restart", null); }));

            inspDock.Children.Add(inspRight);
            inspBorder.Child = inspDock;
            DockPanel.SetDock(inspBorder, Dock.Top);
            rightDock.Children.Add(inspBorder);

            // 2. Navigation Bar for 7 Tabs (Floating Pill Bar)
            Border tabsBar = new Border
            {
                Background = Brushes.Transparent,
                Padding = new Thickness(12, 2, 12, 6)
            };
            WrapPanel tabsWrap = new WrapPanel { Orientation = Orientation.Horizontal };
            string[] tabTitles = new string[]
            {
                "💬 Konsol",
                "🎒 Envanter & Menü",
                "🌾 Farm & Eylemler",
                "🏗️ Oto-İnşa (PRO)",
                "🛡️ Koruma (PRO)",
                "📡 Radar & Hareket (PRO)",
                "⚙️ Genel Ayarlar"
            };
            for (int i = 0; i < tabTitles.Length; i++)
            {
                int idx = i;
                Button tBtn = UiTheme.CreateButton(tabTitles[i], i == 0 ? "primary" : "outline", delegate { SwitchMainTab(idx); }, new Thickness(14, 7, 14, 7));
                tabButtons.Add(tBtn);
                tabsWrap.Children.Add(tBtn);
            }
            tabsBar.Child = tabsWrap;
            DockPanel.SetDock(tabsBar, Dock.Top);
            rightDock.Children.Add(tabsBar);

            // 3. Tab Content Container
            Grid tabHost = new Grid { Background = UiTheme.BgBase };

            tabPanes.Add(BuildTab1Console());
            tabPanes.Add(BuildTab2Inventory());
            tabPanes.Add(BuildTab3FarmActions());
            tabPanes.Add(BuildTab4AutoBuilder());
            tabPanes.Add(BuildTab5Defense());
            tabPanes.Add(BuildTab6Radar());
            tabPanes.Add(BuildTab7Settings());

            for (int i = 0; i < tabPanes.Count; i++)
            {
                tabPanes[i].Visibility = i == 0 ? Visibility.Visible : Visibility.Collapsed;
                tabHost.Children.Add(tabPanes[i]);
            }

            proLockOverlay = BuildProLockView();
            proLockOverlay.Visibility = Visibility.Collapsed;
            tabHost.Children.Add(proLockOverlay);

            rightDock.Children.Add(tabHost);
            return rightDock;
        }

        private Border BuildProLockView()
        {
            Border overlay = new Border { Background = UiTheme.BgBase, Padding = new Thickness(30) };
            Border card = UiTheme.CreateCard(new Thickness(32), new Thickness(0));
            card.MaxWidth = 560;
            card.HorizontalAlignment = HorizontalAlignment.Center;
            card.VerticalAlignment = VerticalAlignment.Center;
            card.BorderBrush = UiTheme.Indigo;

            StackPanel sp = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center };
            sp.Children.Add(UiTheme.CreateText("🔒 PRO ÜYELİĞE ÖZEL MODÜL", 18, FontWeights.ExtraBold, UiTheme.AccentWhite, new Thickness(0, 0, 0, 8)));
            lblProLockTitle = UiTheme.CreateText("Bu gelişmiş otomasyon modülü yalnızca PRO paket kullanıcılarına açıktır.", 13.5, FontWeights.SemiBold, UiTheme.Yellow, new Thickness(0, 0, 0, 12));
            sp.Children.Add(lblProLockTitle);
            sp.Children.Add(UiTheme.CreateText("• Sınırsız Minecraft Hesabı & Proxy Havuzu\n• Schematica / Litematica 3D Oto-İnşa & Çoklu Bot İş Birliği\n• Gelişmiş Koruma, Panik Çıkışı & Anti-Cheat Client/HWID Spoofing\n• 2D / 3D İzometrik Canlı Voksel Radar & Hareket Kontrolü", 12.5, FontWeights.Normal, UiTheme.TextMuted, new Thickness(0, 0, 0, 18)));

            StackPanel btns = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Center };
            btns.Children.Add(UiTheme.CreateButton("🔑 PRO Lisans Girişi / Yükselt (175.00 TL)", "primary", delegate { OpenKeyAuthDialog(""); }, new Thickness(16, 9, 16, 9)));
            btns.Children.Add(UiTheme.CreateButton("📋 Discord: cagat", "indigo", delegate
            {
                try { Clipboard.SetText("cagat"); } catch { }
                ShowToast("Discord kullanıcı adı 'cagat' kopyalandı!", "success");
            }, new Thickness(14, 9, 14, 9)));
            sp.Children.Add(btns);

            card.Child = sp;
            overlay.Child = card;
            return overlay;
        }

        private void SwitchMainTab(int index)
        {
            activeTabIndex = index;
            string[] tabTitles = new string[]
            {
                "💬 Konsol",
                "🎒 Envanter & Menü",
                "🌾 Farm & Eylemler",
                "🏗️ Oto-İnşa (PRO)",
                "🛡️ Koruma (PRO)",
                "📡 Radar & Hareket (PRO)",
                "⚙️ Genel Ayarlar"
            };
            for (int i = 0; i < tabButtons.Count; i++)
            {
                UiTheme.SetButtonVariant(tabButtons[i], tabTitles[i], i == index ? "primary" : "outline");
            }

            bool isProTab = (index == 3 || index == 4 || index == 5);
            bool showLock = isProTab && !IsProUser();

            for (int i = 0; i < tabPanes.Count; i++)
            {
                tabPanes[i].Visibility = (!showLock && i == index) ? Visibility.Visible : Visibility.Collapsed;
            }
            proLockOverlay.Visibility = showLock ? Visibility.Visible : Visibility.Collapsed;

            if (showLock)
            {
                if (index == 3) lblProLockTitle.Text = "Schematica / Litematica Otomatik İnşa (Auto-Builder) Modülü (PRO • 175.00 TL)";
                else if (index == 4) lblProLockTitle.Text = "Gelişmiş Koruma & Anti-Cheat Spoofing Modülü (PRO • 175.00 TL)";
                else if (index == 5) lblProLockTitle.Text = "2D / 3D Canlı Radar & Hareket Kontrolü Modülü (PRO • 175.00 TL)";
                return;
            }

            if (index == 1) RenderInventoryAndContainer();
            else if (index == 3)
            {
                RenderBuilderTab();
                FetchBuilderPreview();
            }
            else if (index == 5)
            {
                FetchRadarSnapshot();
            }
            else if (index == 6)
            {
                PopulateSettingsInputsFromState();
            }
        }

        // =====================================================================
        // TAB 1: KONSOL
        // =====================================================================
        private UIElement BuildTab1Console()
        {
            Grid grid = new Grid { Margin = new Thickness(14, 4, 14, 14) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(12) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(285) });

            // Left: Floating Console Card (Header + Log Viewer + Chat Input)
            Border leftCard = UiTheme.CreateCard(new Thickness(0), new Thickness(0));
            DockPanel leftDock = new DockPanel();

            Border consoleTop = new Border
            {
                BorderBrush = UiTheme.BorderBrush,
                BorderThickness = new Thickness(0, 0, 0, 1),
                Padding = new Thickness(16, 10, 16, 10)
            };
            DockPanel topBarDock = new DockPanel();
            StackPanel leftTopInfo = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            leftTopInfo.Children.Add(UiTheme.CreateIconBox("💬", false));
            leftTopInfo.Children.Add(UiTheme.CreateText("CANLI KONSOL ", 13, FontWeights.ExtraBold, UiTheme.ForestGreen, new Thickness(0, 0, 10, 0)));
            Border balBadge = new Border
            {
                Background = UiTheme.GreenBg,
                BorderBrush = UiTheme.BrushHex("#A7F3D0"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(10, 3, 10, 3),
                Margin = new Thickness(0, 0, 10, 0)
            };
            lblChatBalance = UiTheme.CreateText("💰 Bakiye: -", 11.5, FontWeights.Bold, UiTheme.Green);
            balBadge.Child = lblChatBalance;
            leftTopInfo.Children.Add(balBadge);

            chkShowAllLogs = UiTheme.CreateCheckBox("Tüm hesapların kayıtlarını göster", true);
            chkShowAllLogs.Checked += delegate { RenderConsoleLogs(); };
            chkShowAllLogs.Unchecked += delegate { RenderConsoleLogs(); };
            leftTopInfo.Children.Add(chkShowAllLogs);
            DockPanel.SetDock(leftTopInfo, Dock.Left);
            topBarDock.Children.Add(leftTopInfo);

            StackPanel rightTopBtns = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
            rightTopBtns.Children.Add(UiTheme.CreateButton("🔑 /login Gönder", "outline", delegate { SendSelectedBotAction("manualAuth", new Dictionary<string, object> { { "type", "login" } }); }, new Thickness(9, 4, 9, 4)));
            rightTopBtns.Children.Add(UiTheme.CreateButton("📝 /register Gönder", "outline", delegate { SendSelectedBotAction("manualAuth", new Dictionary<string, object> { { "type", "register" } }); }, new Thickness(9, 4, 9, 4)));
            rightTopBtns.Children.Add(UiTheme.CreateButton("🗑️ Temizle", "danger", delegate { logs.Clear(); RenderConsoleLogs(); }, new Thickness(9, 4, 9, 4)));
            topBarDock.Children.Add(rightTopBtns);
            consoleTop.Child = topBarDock;
            DockPanel.SetDock(consoleTop, Dock.Top);
            leftDock.Children.Add(consoleTop);

            // Bottom Chat Input Bar
            Border chatInputBar = new Border
            {
                BorderBrush = UiTheme.BorderBrush,
                BorderThickness = new Thickness(0, 1, 0, 0),
                Padding = new Thickness(16, 11, 16, 11)
            };
            Grid chatGrid = new Grid();
            chatGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(165) });
            chatGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(8) });
            chatGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            chatGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(8) });
            chatGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            cmbChatTarget = UiTheme.CreateComboBox(new string[] { "Seçili Hesap", "Tüm Aktif Hesaplar" }, 0);
            Grid.SetColumn(cmbChatTarget, 0);
            chatGrid.Children.Add(cmbChatTarget);

            txtChatInput = UiTheme.CreateInput("", "Sohbet mesajı veya /komut yazıp Enter'a basın...");
            txtChatInput.KeyDown += delegate(object s, KeyEventArgs e)
            {
                if (e.Key == Key.Enter) SendChatMessageFromBar();
            };
            Grid.SetColumn(txtChatInput, 2);
            chatGrid.Children.Add(txtChatInput);

            Button btnSendChat = UiTheme.CreateButton("Gönder", "primary", delegate { SendChatMessageFromBar(); }, new Thickness(18, 7, 18, 7));
            Grid.SetColumn(btnSendChat, 4);
            chatGrid.Children.Add(btnSendChat);
            chatInputBar.Child = chatGrid;
            DockPanel.SetDock(chatInputBar, Dock.Bottom);
            leftDock.Children.Add(chatInputBar);

            // Log ScrollViewer (Soft Warm Sand inner surface)
            Border logInner = UiTheme.CreateSubCard(new Thickness(0), new Thickness(14, 10, 14, 10));
            scrollLogs = new ScrollViewer
            {
                Background = Brushes.Transparent,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                Padding = new Thickness(14, 10, 14, 10)
            };
            panelLogLines = new StackPanel();
            scrollLogs.Content = panelLogLines;
            logInner.Child = scrollLogs;
            leftDock.Children.Add(logInner);

            leftCard.Child = leftDock;
            Grid.SetColumn(leftCard, 0);
            grid.Children.Add(leftCard);

            // Right: Live Scoreboard Card + Online Players Card
            Grid rightGrid = new Grid();
            rightGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(255) });
            rightGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(10) });
            rightGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

            // Scoreboard Card
            Border sbCard = UiTheme.CreateCard(new Thickness(0), new Thickness(0));
            DockPanel sbDock = new DockPanel();
            Border sbHeader = new Border
            {
                BorderBrush = UiTheme.BorderBrush,
                BorderThickness = new Thickness(0, 0, 0, 1),
                Padding = new Thickness(14, 10, 14, 10)
            };
            lblSbTitle = UiTheme.CreateText("📊 CANLI SCOREBOARD", 12, FontWeights.ExtraBold, UiTheme.ForestGreen);
            sbHeader.Child = lblSbTitle;
            DockPanel.SetDock(sbHeader, Dock.Top);
            sbDock.Children.Add(sbHeader);

            lblSbMeta = UiTheme.CreateText("", 11, FontWeights.Bold, UiTheme.Green, new Thickness(14, 6, 14, 2));
            DockPanel.SetDock(lblSbMeta, Dock.Top);
            sbDock.Children.Add(lblSbMeta);

            ScrollViewer svSb = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Padding = new Thickness(14, 6, 14, 10) };
            panelSbLines = new StackPanel();
            svSb.Content = panelSbLines;
            sbDock.Children.Add(svSb);
            sbCard.Child = sbDock;
            Grid.SetRow(sbCard, 0);
            rightGrid.Children.Add(sbCard);

            // Online Players Card
            Border plCard = UiTheme.CreateCard(new Thickness(0), new Thickness(0));
            DockPanel plDock = new DockPanel();
            Border plHeader = new Border
            {
                BorderBrush = UiTheme.BorderBrush,
                BorderThickness = new Thickness(0, 0, 0, 1),
                Padding = new Thickness(14, 10, 14, 10)
            };
            lblOnlinePlayersCount = UiTheme.CreateText("👥 ÇEVRİMİÇİ OYUNCULAR (0)", 12, FontWeights.ExtraBold, UiTheme.ForestGreen);
            plHeader.Child = lblOnlinePlayersCount;
            DockPanel.SetDock(plHeader, Dock.Top);
            plDock.Children.Add(plHeader);

            ScrollViewer svPlayers = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Padding = new Thickness(14, 6, 14, 10) };
            panelOnlinePlayers = new StackPanel();
            svPlayers.Content = panelOnlinePlayers;
            plDock.Children.Add(svPlayers);
            plCard.Child = plDock;
            Grid.SetRow(plCard, 2);
            rightGrid.Children.Add(plCard);

            Grid.SetColumn(rightGrid, 2);
            grid.Children.Add(rightGrid);

            return grid;
        }

        private void SendChatMessageFromBar()
        {
            string msg = txtChatInput.Text.Trim();
            if (string.IsNullOrEmpty(msg)) return;
            bool toAll = cmbChatTarget.SelectedIndex == 1;
            Dictionary<string, object> body = new Dictionary<string, object>();
            body["accountId"] = toAll ? "all" : (selectedAccountId ?? "");
            body["message"] = msg;
            txtChatInput.Text = "";
            pipe.SendApiAsync("POST", "/api/chat", body);
        }

        // =====================================================================
        // TAB 2: ENVANTER & MENÜ
        // =====================================================================
        private UIElement BuildTab2Inventory()
        {
            ScrollViewer sv = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Padding = new Thickness(16) };
            StackPanel sp = new StackPanel();

            // 1. Open Container / Menu Panel (openWindow)
            Border winCard = UiTheme.CreateCard(new Thickness(16), new Thickness(0, 0, 0, 14));
            StackPanel winStack = new StackPanel();
            DockPanel winHeader = new DockPanel { Margin = new Thickness(0, 0, 0, 10) };
            StackPanel winLeft = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            lblOpenWinTitle = UiTheme.CreateText("📦 Açık Sunucu Menüsü / Sandık: Yok", 14, FontWeights.ExtraBold, UiTheme.ForestGreen, new Thickness(0, 0, 10, 0));
            winLeft.Children.Add(lblOpenWinTitle);
            lblOpenWinSlots = UiTheme.CreateText("(0 Slot)", 12, FontWeights.Bold, UiTheme.TextMuted);
            winLeft.Children.Add(lblOpenWinSlots);
            DockPanel.SetDock(winLeft, Dock.Left);
            winHeader.Children.Add(winLeft);

            StackPanel winBtns = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
            winBtns.Children.Add(UiTheme.CreateButton("🖱️ Eldeki Eşyaya Sağ Tıkla", "outline", delegate { SendSelectedBotAction("useHeldItem", null); }));
            winBtns.Children.Add(UiTheme.CreateButton("✕ Menüyü Kapat", "danger", delegate { SendSelectedBotAction("closeWindow", null); }));
            winHeader.Children.Add(winBtns);
            winStack.Children.Add(winHeader);

            winStack.Children.Add(UiTheme.CreateText("İpucu: Slota Sol Tık = Tıkla/Al (Button 0)  |  Slota Sağ Tık = Tekli Al (Button 1)", 11.5, FontWeights.Normal, UiTheme.TextMuted, new Thickness(0, 0, 0, 8)));
            
            // Container Slots Frame (9 Columns)
            Border winFrame = new Border
            {
                Background = UiTheme.BrushHex("#181716"),
                BorderBrush = UiTheme.BrushHex("#3D3833"),
                BorderThickness = new Thickness(2),
                CornerRadius = new CornerRadius(8),
                Padding = new Thickness(6),
                HorizontalAlignment = HorizontalAlignment.Left
            };
            gridOpenWinSlots = new UniformGrid { Columns = 9 };
            winFrame.Child = gridOpenWinSlots;
            winStack.Children.Add(winFrame);
            wrapOpenWinSlots = new WrapPanel { Visibility = Visibility.Collapsed };
            winStack.Children.Add(wrapOpenWinSlots);

            winCard.Child = winStack;
            sp.Children.Add(winCard);

            // 2. Bot Inventory Panel (Real Minecraft 9x4 Grid + Held Item Spotlight)
            Border invCard = UiTheme.CreateCard(new Thickness(16), new Thickness(0));
            StackPanel invStack = new StackPanel();
            DockPanel invHeader = new DockPanel { Margin = new Thickness(0, 0, 0, 12) };
            StackPanel invLeft = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            invLeft.Children.Add(UiTheme.CreateText("🎒 Bot Envanteri (36 Slot)", 14, FontWeights.ExtraBold, UiTheme.ForestGreen, new Thickness(0, 0, 12, 0)));
            lblHeldItemBadge = UiTheme.CreateText("✋ Eldeki: Boş El", 12, FontWeights.Bold, UiTheme.Green);
            invLeft.Children.Add(lblHeldItemBadge);
            DockPanel.SetDock(invLeft, Dock.Left);
            invHeader.Children.Add(invLeft);

            StackPanel invBtns = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
            invBtns.Children.Add(UiTheme.CreateButton("⚔️ Eldeki Eşyayı Kullan", "outline", delegate { SendSelectedBotAction("useHeldItem", null); }, new Thickness(8, 4, 8, 4)));
            invBtns.Children.Add(UiTheme.CreateButton("🗑️ Tümünü Yere At", "danger", delegate { SendSelectedBotAction("dropAll", null); }, new Thickness(8, 4, 8, 4)));
            invHeader.Children.Add(invBtns);
            invStack.Children.Add(invHeader);

            // Held Item Spotlight Card
            heldItemCard = new Border
            {
                Background = UiTheme.BgInput,
                BorderBrush = UiTheme.BorderBrush,
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(12, 9, 12, 9),
                Margin = new Thickness(0, 0, 0, 12),
                HorizontalAlignment = HorizontalAlignment.Left,
                MinWidth = 428
            };
            DockPanel heldDock = new DockPanel();
            heldItemSlotBorder = new Border
            {
                Width = 44,
                Height = 44,
                Background = UiTheme.BrushHex("#242220"),
                BorderBrush = UiTheme.BrushHex("#3D3833"),
                BorderThickness = new Thickness(2),
                CornerRadius = new CornerRadius(6)
            };
            DockPanel.SetDock(heldItemSlotBorder, Dock.Left);
            heldDock.Children.Add(heldItemSlotBorder);

            StackPanel heldDetails = new StackPanel { Margin = new Thickness(12, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center };
            lblHeldItemName = UiTheme.CreateText("Boş El (Eşya Seçilmedi)", 13, FontWeights.Bold, UiTheme.ForestGreen);
            lblHeldItemDurability = UiTheme.CreateText("Dayanıklılık: -", 11, FontWeights.Normal, UiTheme.TextMuted, new Thickness(0, 2, 0, 0));
            heldDetails.Children.Add(lblHeldItemName);
            heldDetails.Children.Add(lblHeldItemDurability);
            heldDock.Children.Add(heldDetails);
            heldItemCard.Child = heldDock;
            invStack.Children.Add(heldItemCard);

            // Main Inventory (Slots 9..35) Header & Frame
            invStack.Children.Add(UiTheme.CreateText("📦 Ana Depolama (Slot 9 - 35)", 11.5, FontWeights.ExtraBold, UiTheme.TextDim, new Thickness(2, 4, 0, 6)));
            Border mainInvFrame = new Border
            {
                Background = UiTheme.BrushHex("#181716"),
                BorderBrush = UiTheme.BrushHex("#3D3833"),
                BorderThickness = new Thickness(2),
                CornerRadius = new CornerRadius(8),
                Padding = new Thickness(6),
                HorizontalAlignment = HorizontalAlignment.Left
            };
            gridMainInv = new UniformGrid { Columns = 9 };
            mainInvFrame.Child = gridMainInv;
            invStack.Children.Add(mainInvFrame);

            // Hotbar (Slots 36..44) Header & Frame
            invStack.Children.Add(UiTheme.CreateText("⚡ Hızlı Erişim / Hotbar (Slot 36 - 44)", 11.5, FontWeights.ExtraBold, UiTheme.TextDim, new Thickness(2, 12, 0, 6)));
            Border hotbarFrame = new Border
            {
                Background = UiTheme.BrushHex("#181716"),
                BorderBrush = UiTheme.ForestGreen,
                BorderThickness = new Thickness(2),
                CornerRadius = new CornerRadius(8),
                Padding = new Thickness(6),
                HorizontalAlignment = HorizontalAlignment.Left
            };
            gridHotbar = new UniformGrid { Columns = 9 };
            hotbarFrame.Child = gridHotbar;
            invStack.Children.Add(hotbarFrame);

            wrapBotInvSlots = new WrapPanel { Visibility = Visibility.Collapsed };
            invStack.Children.Add(wrapBotInvSlots);

            invStack.Children.Add(UiTheme.CreateText("💡 İpucu: Slota Sol Tık = Kuşan / Ele Al (equipItem)  |  Slota Sağ Tık = Yere At (dropItem)", 11, FontWeights.Normal, UiTheme.TextMuted, new Thickness(2, 10, 0, 0)));
            invCard.Child = invStack;
            sp.Children.Add(invCard);

            sv.Content = sp;
            return sv;
        }

        // =====================================================================
        // TAB 3: FARM & EYLEMLER
        // =====================================================================
        private UIElement BuildTab3FarmActions()
        {
            ScrollViewer sv = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Padding = new Thickness(16) };
            StackPanel sp = new StackPanel();

            // 1. Live Farm Counters Bar
            Border statBar = UiTheme.CreateCard(new Thickness(14, 10, 14, 10), new Thickness(0, 0, 0, 12));
            DockPanel statDock = new DockPanel();
            Button btnResetStats = UiTheme.CreateButton("🔄 Sıfırla", "outline", delegate { SendSelectedBotAction("resetStats", null); }, new Thickness(10, 4, 10, 4));
            DockPanel.SetDock(btnResetStats, Dock.Right);
            statDock.Children.Add(btnResetStats);
            lblFarmCounters = UiTheme.CreateText("⛏️ Kazılan Blok: 0  |  ⚔️ Kesilen Mob: 0  |  🌾 Hasat: 0  |  🌱 Çapalanan: 0  |  🌿 Ekilen: 0  |  💰 Çiftçi Satış: 0  |  🛠️ Tamir: 0  |  📦 Sandık: 0  |  🛡️ Captcha: 0", 12, FontWeights.Bold, UiTheme.AccentWhite);
            statDock.Children.Add(lblFarmCounters);
            statBar.Child = statDock;
            sp.Children.Add(statBar);

            // 2. 12 Automation Mode Cards
            sp.Children.Add(UiTheme.CreateText("⚡ OTOMASYON MODLARI (12 AKTİF MODÜL)", 12.5, FontWeights.ExtraBold, UiTheme.AccentWhite, new Thickness(2, 0, 0, 8)));
            UniformGrid modesGrid = new UniformGrid { Columns = 3, Margin = new Thickness(0, 0, 0, 14) };

            AddAutomationModeCard(modesGrid, "toggleAutoMine", "⛏️ Otomatik Blok Kırma", "Baktığı yöndeki blokları sürekli kazar.", null, null);
            AddAutomationModeCard(modesGrid, "toggleAutoAttack", "⚔️ Otomatik Mob Kesme", "Yakındaki moblara otomatik saldırır.", null, null);
            AddAutomationModeCard(modesGrid, "toggleAutoFarm", "🌾 Otomatik Tarla Hasatı", "Olgunlaşmış ekinleri otomatik biçer.", null, null);
            AddAutomationModeCard(modesGrid, "toggleAutoTill", "🌱 Otomatik Tarla Çapalama", "Toprak bloklarını çapa ile tarlaya çevirir.", null, null);
            AddAutomationModeCard(modesGrid, "toggleAutoPlant", "🌿 Otomatik Tarla Ekimi", "Çapalanmış tarlalara tohum eker.", null, null);
            AddAutomationModeCard(modesGrid, "toggleAutoFarmerSell", "💰 Otomatik Çiftçi Satıcı", "Belirli aralıkla /çiftçi üzerinden satış yapar.", "⚡ Şimdi Sat", delegate { SendSelectedBotAction("farmerSellNow", null); });
            AddAutomationModeCard(modesGrid, "toggleAutoMinerChestSell", "🪨 Miner Sandık Cobblestone Satıcı", "Miner sandığındaki taşları otomatik satar.", "⚡ Şimdi Sat", delegate { SendSelectedBotAction("minerChestSellNow", null); });
            AddAutomationModeCard(modesGrid, "toggleAutoSpawnerRoutine", "🏭 Sınırsız Spawner Demir & Poppy Modu", "Spawnerlardan demir ve poppy toplayıp satar.", "⚡ Şimdi Başlat", delegate { SendSelectedBotAction("spawnerRoutineNow", null); }, true, false);
            AddAutomationModeCard(modesGrid, "toggleAutoJackOLantern", "🎃 Otomatik Balkabağı Feneri", "Balkabağı oyup meşale ile Jack o'Lantern üretir.", "⚡ Şimdi Başlat", delegate { SendSelectedBotAction("jackOLanternNow", null); }, false, true);
            AddAutomationModeCard(modesGrid, "toggleAutoRightClick", "🖱️ Otomatik Sağ Tıklama", "Baktığı bloğa/eşyaya sürekli sağ tıklar.", null, null);
            AddAutomationModeCard(modesGrid, "toggleAutoChest", "📦 Otomatik Sandık Boşaltma", "Envanter dolunca yakındaki sandığa aktarır.", null, null);
            AddAutomationModeCard(modesGrid, "toggleSneak", "🦵 Eğilme Kilidi (Sneak)", "Botu sürekli eğilmiş (Shift) modda tutar.", null, null);

            sp.Children.Add(modesGrid);

            // 3. 8 Bot Rule CheckBoxes
            Border rulesCard = UiTheme.CreateCard(new Thickness(14), new Thickness(0, 0, 0, 12));
            StackPanel rulesStack = new StackPanel();
            rulesStack.Children.Add(UiTheme.CreateText("📋 BOT DAVRANIŞ KURALLARI", 12, FontWeights.ExtraBold, UiTheme.AccentWhite, new Thickness(0, 0, 0, 8)));
            UniformGrid rulesGrid = new UniformGrid { Columns = 4 };
            AddBotRuleCheckBox(rulesGrid, "autoReconnect", "🔄 Otomatik Yeniden Bağlan");
            AddBotRuleCheckBox(rulesGrid, "autoPickup", "🧲 Yerdeki Eşyaları Topla");
            AddBotRuleCheckBox(rulesGrid, "autoDepositChest", "📦 Dolunca Sandığa Aktar");
            AddBotRuleCheckBox(rulesGrid, "autoEquipTool", "🔨 Otomatik Uygun Alet Seç");
            AddBotRuleCheckBox(rulesGrid, "autoToolRepair", "🛠️ Alet Kırılmadan Tamir Et");
            AddBotRuleCheckBox(rulesGrid, "autoCaptcha", "🛡️ Otomatik Captcha Çözücü");
            AddBotRuleCheckBox(rulesGrid, "prioritizeHarvestBeforePlant", "🌾 Ekimden Önce Hasat Önceliği");
            AddBotRuleCheckBox(rulesGrid, "farmerAutoSell", "💰 Çiftçi Otomatik Satış");
            rulesStack.Children.Add(rulesGrid);
            rulesCard.Child = rulesStack;
            sp.Children.Add(rulesCard);

            // 4. Quick Actions Row
            Border quickCard = UiTheme.CreateCard(new Thickness(14), new Thickness(0, 0, 0, 12));
            StackPanel quickStack = new StackPanel();
            quickStack.Children.Add(UiTheme.CreateText("🚀 HIZLI EYLEMLER & KOMUTLAR", 12, FontWeights.ExtraBold, UiTheme.AccentWhite, new Thickness(0, 0, 0, 8)));
            WrapPanel quickWrap = new WrapPanel();
            quickWrap.Children.Add(UiTheme.CreateButton("⬆️ Zıpla", "outline", delegate { SendSelectedBotAction("jump", null); }));
            quickWrap.Children.Add(UiTheme.CreateButton("👋 Kol Salla", "outline", delegate { SendSelectedBotAction("swing", null); }));
            quickWrap.Children.Add(UiTheme.CreateButton("🖱️ Eldekini Kullan", "outline", delegate { SendSelectedBotAction("useHeldItem", null); }));
            quickWrap.Children.Add(UiTheme.CreateButton("🛠️ Şimdi Tamir Et", "outline", delegate { SendSelectedBotAction("repairHeldItemNow", null); }));
            quickWrap.Children.Add(UiTheme.CreateButton("📦 Şimdi Sandığa Aktar", "outline", delegate { SendSelectedBotAction("depositChestNow", null); }));
            quickWrap.Children.Add(UiTheme.CreateButton("🗑️ Yere At", "danger", delegate { SendSelectedBotAction("dropAll", null); }));
            quickWrap.Children.Add(UiTheme.CreateButton("🏝️ /is", "indigo", delegate { SendQuickCommand("/is"); }));
            quickWrap.Children.Add(UiTheme.CreateButton("🏰 /spawn", "indigo", delegate { SendQuickCommand("/spawn"); }));
            quickWrap.Children.Add(UiTheme.CreateButton("👨‍🌾 /çiftçi", "indigo", delegate { SendQuickCommand("/çiftçi"); }));
            quickStack.Children.Add(quickWrap);
            quickCard.Child = quickStack;
            sp.Children.Add(quickCard);

            // 5. Advanced Farm Settings Section
            Border advCard = UiTheme.CreateCard(new Thickness(16), new Thickness(0));
            StackPanel advStack = new StackPanel();
            advStack.Children.Add(UiTheme.CreateText("⚙️ GELİŞMİŞ FARM, SPAWNER & BALKABAĞI FENERİ AYARLARI", 12.5, FontWeights.ExtraBold, UiTheme.AccentWhite, new Thickness(0, 0, 0, 10)));

            UniformGrid advGrid1 = new UniformGrid { Columns = 4, Margin = new Thickness(0, 0, 0, 10) };
            txtAdvRepairCmd = AddLabeledInput(advGrid1, "Tamir Komutu", "/tamir");
            txtAdvRepairPct = AddLabeledInput(advGrid1, "Tamir Eşiği (%)", "15");
            txtAdvFarmerSec = AddLabeledInput(advGrid1, "Çiftçi Satış Süresi (sn)", "120");
            txtAdvMinerSec = AddLabeledInput(advGrid1, "Miner Sandık Süresi (sn)", "10");
            advStack.Children.Add(advGrid1);

            UniformGrid advGrid2 = new UniformGrid { Columns = 3, Margin = new Thickness(0, 0, 0, 10) };
            txtAdvSpawnerSec = AddLabeledInput(advGrid2, "Spawner Tur Süresi (sn)", "30");
            txtAdvSpawnerCount = AddLabeledInput(advGrid2, "Spawner Sayısı (0=Oto)", "0");
            txtAdvSpawnerCoords = AddLabeledInput(advGrid2, "Özel Spawner Koordinatları (X Y Z; ...)", "");
            advStack.Children.Add(advGrid2);

            advStack.Children.Add(UiTheme.CreateText("🎃 Balkabağı Feneri (Jack o'Lantern) 8 Parametreli Üretim Yapılandırması", 12, FontWeights.Bold, UiTheme.Yellow, new Thickness(0, 4, 0, 6)));
            UniformGrid jackGrid = new UniformGrid { Columns = 4, Margin = new Thickness(0, 0, 0, 10) };
            txtJackInterval = AddLabeledInput(jackGrid, "Kontrol Süresi (sn)", "20");
            txtJackBatch = AddLabeledInput(jackGrid, "Parti Boyutu (1-64)", "32");
            txtJackPumpkinChest = AddLabeledInput(jackGrid, "Balkabağı Sandığı (X Y Z)", "");
            txtJackTorchChest = AddLabeledInput(jackGrid, "Meşale Sandığı (X Y Z)", "");
            txtJackOutputChest = AddLabeledInput(jackGrid, "Çıktı Fener Sandığı (X Y Z)", "");
            txtJackIronChest = AddLabeledInput(jackGrid, "Demir Sandığı (Makas İçin)", "");
            txtJackStickChest = AddLabeledInput(jackGrid, "Çubuk/Kömür Sandığı", "");
            txtJackCarveSpot = AddLabeledInput(jackGrid, "Oyma Noktası (X Y Z)", "");
            advStack.Children.Add(jackGrid);

            StackPanel advBtns = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
            advBtns.Children.Add(UiTheme.CreateButton("📍 Önümdeki Bloğu Al (Oyma Noktası)", "outline", OnSetCarveSpotFrontClick));
            advBtns.Children.Add(UiTheme.CreateButton("💾 Gelişmiş Farm Ayarlarını Kaydet", "primary", OnSaveAdvancedFarmSettingsClick));
            advStack.Children.Add(advBtns);

            advCard.Child = advStack;
            sp.Children.Add(advCard);

            sv.Content = sp;
            return sv;
        }

        private void AddAutomationModeCard(Panel parent, string actionKey, string title, string desc, string secondaryText, RoutedEventHandler secondaryClick, bool isSpawner = false, bool isJack = false)
        {
            Border card = UiTheme.CreateCard(new Thickness(14), new Thickness(5));
            StackPanel sp = new StackPanel();
            sp.Children.Add(UiTheme.CreateText(title, 13, FontWeights.ExtraBold, UiTheme.ForestGreen, new Thickness(0, 0, 0, 3)));
            sp.Children.Add(UiTheme.CreateText(desc, 11.5, FontWeights.Normal, UiTheme.TextMuted, new Thickness(0, 0, 0, 8)));

            Border innerBox = UiTheme.CreateSubCard(new Thickness(8, 6, 8, 6), new Thickness(0));
            StackPanel btns = new StackPanel { Orientation = Orientation.Horizontal };
            Button toggleBtn = UiTheme.CreateButton("Kapalı", "outline", delegate { SendSelectedBotAction(actionKey, null); }, new Thickness(11, 5, 11, 5));
            autoModeToggleBtns[actionKey] = toggleBtn;
            btns.Children.Add(toggleBtn);

            if (!string.IsNullOrEmpty(secondaryText) && secondaryClick != null)
            {
                Button secBtn = UiTheme.CreateButton(secondaryText, "sand", secondaryClick, new Thickness(10, 5, 10, 5));
                if (isSpawner) btnSpawnerNow = secBtn;
                if (isJack) btnJackNow = secBtn;
                btns.Children.Add(secBtn);
            }

            innerBox.Child = btns;
            sp.Children.Add(innerBox);
            card.Child = sp;
            parent.Children.Add(card);
        }

        private void AddBotRuleCheckBox(Panel parent, string ruleKey, string label)
        {
            CheckBox cb = UiTheme.CreateCheckBox(label, true);
            cb.Checked += delegate { OnBotRuleCheckChanged(ruleKey, true); };
            cb.Unchecked += delegate { OnBotRuleCheckChanged(ruleKey, false); };
            botRuleChecks[ruleKey] = cb;
            parent.Children.Add(cb);
        }

        private void OnBotRuleCheckChanged(string ruleKey, bool val)
        {
            if (isUpdatingBotRuleChecks || string.IsNullOrEmpty(selectedAccountId)) return;
            Dictionary<string, object> body = new Dictionary<string, object>();
            body[ruleKey] = val;
            if (ruleKey == "autoEquipTool") body["autoTool"] = val;
            if (ruleKey == "autoToolRepair") body["autoRepair"] = val;
            if (ruleKey == "farmerAutoSell") body["autoSellEnabled"] = val;
            pipe.SendApiAsync("PUT", "/api/accounts/" + selectedAccountId, body);
        }

        private TextBox AddLabeledInput(Panel parent, string label, string defaultVal)
        {
            StackPanel sp = new StackPanel { Margin = new Thickness(4) };
            sp.Children.Add(UiTheme.CreateText(label, 11, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 0, 0, 3)));
            TextBox tb = UiTheme.CreateInput(defaultVal);
            sp.Children.Add(tb);
            parent.Children.Add(sp);
            return tb;
        }

        private void SendQuickCommand(string cmd)
        {
            if (string.IsNullOrEmpty(selectedAccountId)) return;
            Dictionary<string, object> body = new Dictionary<string, object>();
            body["accountId"] = selectedAccountId;
            body["message"] = cmd;
            pipe.SendApiAsync("POST", "/api/chat", body);
        }

        private void OnSetCarveSpotFrontClick(object sender, RoutedEventArgs e)
        {
            Dictionary<string, object> bot = GetSelectedBot();
            Dictionary<string, object> pos = JsonHelper.SubDict(bot, "position");
            if (pos.Count == 0)
            {
                ShowToast("Bot çevrimiçi değil veya konumu alınamadı!", "error");
                return;
            }
            double yaw = JsonHelper.Dbl(bot, "yaw", 0.0);
            int dx = -(int)Math.Round(Math.Sin(yaw));
            int dz = -(int)Math.Round(Math.Cos(yaw));
            if (dx == 0 && dz == 0) dx = 1;
            int fx = JsonHelper.Int(pos, "x", 0) + dx;
            int fy = JsonHelper.Int(pos, "y", 64);
            int fz = JsonHelper.Int(pos, "z", 0) + dz;
            txtJackCarveSpot.Text = fx + " " + fy + " " + fz;
            ShowToast("Oyma noktası botun önüne ayarlandı: " + txtJackCarveSpot.Text, "success");
        }

        private void OnSaveAdvancedFarmSettingsClick(object sender, RoutedEventArgs e)
        {
            if (string.IsNullOrEmpty(selectedAccountId)) return;

            int repPct = Math.Max(1, Math.Min(95, ParseIntSafe(txtAdvRepairPct.Text, 15)));
            int farmerSec = Math.Max(5, ParseIntSafe(txtAdvFarmerSec.Text, 120));
            int minerSec = Math.Max(5, ParseIntSafe(txtAdvMinerSec.Text, 10));
            int spawnerSec = Math.Max(10, ParseIntSafe(txtAdvSpawnerSec.Text, 30));
            int spawnerCnt = Math.Max(0, ParseIntSafe(txtAdvSpawnerCount.Text, 0));
            int jackSec = Math.Max(5, ParseIntSafe(txtJackInterval.Text, 20));
            int jackBatch = Math.Max(1, Math.Min(64, ParseIntSafe(txtJackBatch.Text, 32)));

            Dictionary<string, object> bot = GetSelectedBot();

            Dictionary<string, object> accPatch = new Dictionary<string, object>();
            accPatch["autoRepairCommand"] = txtAdvRepairCmd.Text.Trim();
            accPatch["autoRepairThreshold"] = repPct;
            pipe.SendApiAsync("PUT", "/api/accounts/" + selectedAccountId, accPatch);

            SendSelectedBotAction("updateFarmerSellConfig", new Dictionary<string, object>
            {
                { "intervalSec", farmerSec },
                { "enabled", JsonHelper.Bool(JsonHelper.SubDict(bot, "autoFarmerSell"), "enabled", false) }
            });

            SendSelectedBotAction("updateMinerChestSellConfig", new Dictionary<string, object>
            {
                { "intervalSec", minerSec },
                { "enabled", JsonHelper.Bool(JsonHelper.SubDict(bot, "autoMinerChestSell"), "enabled", false) }
            });

            SendSelectedBotAction("updateSpawnerRoutineConfig", new Dictionary<string, object>
            {
                { "intervalSec", spawnerSec },
                { "spawnerCount", spawnerCnt },
                { "customCoords", txtAdvSpawnerCoords.Text.Trim() },
                { "enabled", JsonHelper.Bool(JsonHelper.SubDict(bot, "autoSpawnerRoutine"), "enabled", false) }
            });

            SendSelectedBotAction("updateJackOLanternConfig", new Dictionary<string, object>
            {
                { "enabled", JsonHelper.Bool(JsonHelper.SubDict(bot, "autoJackOLantern"), "enabled", false) },
                { "intervalSec", jackSec },
                { "batchSize", jackBatch },
                { "pumpkinChest", txtJackPumpkinChest.Text.Trim() },
                { "torchChest", txtJackTorchChest.Text.Trim() },
                { "outputChest", txtJackOutputChest.Text.Trim() },
                { "ironChest", txtJackIronChest.Text.Trim() },
                { "stickChest", txtJackStickChest.Text.Trim() },
                { "carveSpot", txtJackCarveSpot.Text.Trim() }
            });

            ShowToast("Gelişmiş farm, spawner ve balkabağı feneri ayarları kaydedildi!", "success");
        }

        // =====================================================================
        // TAB 4: OTO-İNŞA (PRO)
        // =====================================================================
        private UIElement BuildTab4AutoBuilder()
        {
            ScrollViewer sv = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Padding = new Thickness(16) };
            Grid grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.15, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(14) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            // Left Column: Upload & Presets, Origin & Corners, Saved Presets, Checkboxes & Actions
            StackPanel leftCol = new StackPanel();

            // Card 1: Schematic Upload & Built-in Presets
            Border cardUpload = UiTheme.CreateCard(new Thickness(14), new Thickness(0, 0, 0, 12));
            StackPanel spUp = new StackPanel();
            spUp.Children.Add(UiTheme.CreateText("🏗️ SCHEMATICA / LITEMATICA ŞEMA YÜKLEYİCİ", 12.5, FontWeights.ExtraBold, UiTheme.AccentWhite, new Thickness(0, 0, 0, 6)));
            lblBuilderSchemInfo = UiTheme.CreateText("Aktif Şema: Yüklenmedi (0x0x0 • 0 Blok)", 12, FontWeights.Bold, UiTheme.Green, new Thickness(0, 0, 0, 8));
            spUp.Children.Add(lblBuilderSchemInfo);

            WrapPanel upBtns = new WrapPanel { Margin = new Thickness(0, 0, 0, 8) };
            upBtns.Children.Add(UiTheme.CreateButton("📂 .schem / .litematic Dosyası Yükle", "primary", OnUploadSchematicClick));
            upBtns.Children.Add(UiTheme.CreateButton("🌵 kaktus_16x16", "outline", delegate { LoadBuiltInSchematicPreset("kaktus_16x16"); }));
            upBtns.Children.Add(UiTheme.CreateButton("🌾 tarla_9x9", "outline", delegate { LoadBuiltInSchematicPreset("tarla_9x9"); }));
            upBtns.Children.Add(UiTheme.CreateButton("🏰 kule_5x5", "outline", delegate { LoadBuiltInSchematicPreset("kule_5x5"); }));
            spUp.Children.Add(upBtns);

            UniformGrid rotDelayGrid = new UniformGrid { Columns = 2 };
            StackPanel spRot = new StackPanel { Margin = new Thickness(0, 0, 6, 0) };
            spRot.Children.Add(UiTheme.CreateText("Döndürme Açısı (Rotation)", 11, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 0, 0, 3)));
            cmbBuilderRotation = UiTheme.CreateComboBox(new string[] { "0°", "90°", "180°", "270°" }, 0);
            spRot.Children.Add(cmbBuilderRotation);
            rotDelayGrid.Children.Add(spRot);

            StackPanel spDelay = new StackPanel { Margin = new Thickness(6, 0, 0, 0) };
            spDelay.Children.Add(UiTheme.CreateText("Blok Koyma Gecikmesi (ms)", 11, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 0, 0, 3)));
            txtBuilderDelay = UiTheme.CreateInput("220");
            spDelay.Children.Add(txtBuilderDelay);
            rotDelayGrid.Children.Add(spDelay);
            spUp.Children.Add(rotDelayGrid);

            cardUpload.Child = spUp;
            leftCol.Children.Add(cardUpload);

            // Card 2: Origin & Corners + Fill Box
            Border cardCoords = UiTheme.CreateCard(new Thickness(14), new Thickness(0, 0, 0, 12));
            StackPanel spCoords = new StackPanel();
            spCoords.Children.Add(UiTheme.CreateText("📍 BAŞLANGIÇ NOKTASI (ORIGIN) & İKİ KÖŞE (POS1 / POS2)", 12, FontWeights.ExtraBold, UiTheme.AccentWhite, new Thickness(0, 0, 0, 8)));

            UniformGrid originGrid = new UniformGrid { Columns = 4, Margin = new Thickness(0, 0, 0, 8) };
            txtBuilderOx = AddLabeledInput(originGrid, "Origin X", "0");
            txtBuilderOy = AddLabeledInput(originGrid, "Origin Y", "64");
            txtBuilderOz = AddLabeledInput(originGrid, "Origin Z", "0");
            StackPanel spOrigBtn = new StackPanel { VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(4) };
            spOrigBtn.Children.Add(UiTheme.CreateButton("📍 Botun Konumunu Al", "outline", delegate { SendSelectedBotAction("builderUseBotPos", null); }));
            originGrid.Children.Add(spOrigBtn);
            spCoords.Children.Add(originGrid);

            UniformGrid pos1Grid = new UniformGrid { Columns = 4, Margin = new Thickness(0, 0, 0, 6) };
            txtBuilderP1x = AddLabeledInput(pos1Grid, "Pos1 X", "0");
            txtBuilderP1y = AddLabeledInput(pos1Grid, "Pos1 Y", "64");
            txtBuilderP1z = AddLabeledInput(pos1Grid, "Pos1 Z", "0");
            StackPanel spP1Btn = new StackPanel { VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(4) };
            spP1Btn.Children.Add(UiTheme.CreateButton("📍 Pos1 = Bot", "outline", delegate { SendSelectedBotAction("builderUseBotPosForCorner", new Dictionary<string, object> { { "corner", "pos1" } }); }));
            pos1Grid.Children.Add(spP1Btn);
            spCoords.Children.Add(pos1Grid);

            UniformGrid pos2Grid = new UniformGrid { Columns = 4, Margin = new Thickness(0, 0, 0, 8) };
            txtBuilderP2x = AddLabeledInput(pos2Grid, "Pos2 X", "0");
            txtBuilderP2y = AddLabeledInput(pos2Grid, "Pos2 Y", "64");
            txtBuilderP2z = AddLabeledInput(pos2Grid, "Pos2 Z", "0");
            StackPanel spP2Btn = new StackPanel { VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(4) };
            spP2Btn.Children.Add(UiTheme.CreateButton("📍 Pos2 = Bot", "outline", delegate { SendSelectedBotAction("builderUseBotPosForCorner", new Dictionary<string, object> { { "corner", "pos2" } }); }));
            pos2Grid.Children.Add(spP2Btn);
            spCoords.Children.Add(pos2Grid);

            UniformGrid fillGrid = new UniformGrid { Columns = 4, Margin = new Thickness(0, 0, 0, 6) };
            txtBuilderFillBlock = AddLabeledInput(fillGrid, "Dolgu Bloğu", "dirt");
            StackPanel spFillMode = new StackPanel { Margin = new Thickness(4) };
            spFillMode.Children.Add(UiTheme.CreateText("Dolgu Modu", 11, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 0, 0, 3)));
            cmbBuilderFillMode = UiTheme.CreateComboBox(new string[] { "solid", "walls", "hollow", "platform", "farm_rows" }, 0);
            spFillMode.Children.Add(cmbBuilderFillMode);
            fillGrid.Children.Add(spFillMode);

            StackPanel spFitBtn = new StackPanel { VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(4) };
            spFitBtn.Children.Add(UiTheme.CreateButton("📐 İki Köşeye Oturt", "outline", OnBuilderFitCornersClick));
            fillGrid.Children.Add(spFitBtn);

            StackPanel spFillBoxBtn = new StackPanel { VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(4) };
            spFillBoxBtn.Children.Add(UiTheme.CreateButton("🧱 Alanı Oluştur", "primary", OnBuilderFillBoxClick));
            fillGrid.Children.Add(spFillBoxBtn);
            spCoords.Children.Add(fillGrid);

            // Saved Presets Row
            spCoords.Children.Add(UiTheme.CreateText("💾 Kayıtlı İnşa Konumları (Presets)", 11.5, FontWeights.Bold, UiTheme.TextMuted, new Thickness(4, 6, 0, 4)));
            WrapPanel presetRow = new WrapPanel();
            cmbBuilderSavedPresets = UiTheme.CreateComboBox(new string[] { "-- Kayıtlı Konum Seçin --" }, 0);
            cmbBuilderSavedPresets.Width = 210;
            cmbBuilderSavedPresets.SelectionChanged += OnBuilderSavedPresetChanged;
            presetRow.Children.Add(cmbBuilderSavedPresets);
            presetRow.Children.Add(UiTheme.CreateButton("💾 Kaydet", "outline", OnBuilderSavePresetClick));
            presetRow.Children.Add(UiTheme.CreateButton("🌐 Tüm Botlara Eşitle", "indigo", OnBuilderSyncAllBotsClick));
            presetRow.Children.Add(UiTheme.CreateButton("🗑️ Sil", "danger", OnBuilderDeletePresetClick));
            spCoords.Children.Add(presetRow);

            cardCoords.Child = spCoords;
            leftCol.Children.Add(cardCoords);

            // Card 3: 4 CheckBoxes & Execution Controls
            Border cardCtrl = UiTheme.CreateCard(new Thickness(14), new Thickness(0));
            StackPanel spCtrl = new StackPanel();
            spCtrl.Children.Add(UiTheme.CreateText("⚙️ İNŞA KONTROLLERİ & ZİNCİRLEME OTOMASYON", 12, FontWeights.ExtraBold, UiTheme.AccentWhite, new Thickness(0, 0, 0, 6)));

            UniformGrid chkGrid = new UniformGrid { Columns = 2, Margin = new Thickness(0, 0, 0, 10) };
            chkBuilderMove = UiTheme.CreateCheckBox("🚶 Bloklara Otomatik Yürü (autoMove)", true);
            chkBuilderClear = UiTheme.CreateCheckBox("⛏️ Engel Blokları Kır (clearObstacles)", false);
            chkBuilderSkip = UiTheme.CreateCheckBox("⏭️ Eksik Blokları Atla (skipMissingBlocks)", false);
            chkBuilderRestock = UiTheme.CreateCheckBox("📦 Sandıktan Malzeme Çek (autoRestockChest)", true);
            chkGrid.Children.Add(chkBuilderMove);
            chkGrid.Children.Add(chkBuilderClear);
            chkGrid.Children.Add(chkBuilderSkip);
            chkGrid.Children.Add(chkBuilderRestock);
            spCtrl.Children.Add(chkGrid);

            WrapPanel actBtns = new WrapPanel { Margin = new Thickness(0, 0, 0, 6) };
            actBtns.Children.Add(UiTheme.CreateButton("▶️ İnşayı Başlat", "success", OnBuilderStartClick, new Thickness(14, 7, 14, 7)));
            btnBuilderPause = UiTheme.CreateButton("⏸️ Duraklat/Devam", "warning", delegate { SendSelectedBotAction("builderPause", null); }, new Thickness(12, 7, 12, 7));
            actBtns.Children.Add(btnBuilderPause);
            actBtns.Children.Add(UiTheme.CreateButton("⏹️ Durdur", "danger", delegate { SendSelectedBotAction("builderStop", null); }, new Thickness(12, 7, 12, 7)));
            spCtrl.Children.Add(actBtns);

            UniformGrid chainCoopGrid = new UniformGrid { Columns = 2 };
            btnBuilderChain = UiTheme.CreateButton("🔄 İnşa➔Çapa➔Ekim Zinciri: AÇIK", "indigo", OnBuilderToggleChainClick);
            btnBuilderCoop = UiTheme.CreateButton("🤝 Çoklu Bot Ortak Çalışma: AÇIK", "success", OnToggleCooperationClick);
            chainCoopGrid.Children.Add(btnBuilderChain);
            chainCoopGrid.Children.Add(btnBuilderCoop);
            spCtrl.Children.Add(chainCoopGrid);

            cardCtrl.Child = spCtrl;
            leftCol.Children.Add(cardCtrl);

            Grid.SetColumn(leftCol, 0);
            grid.Children.Add(leftCol);

            // Right Column: Progress + 2D/Isometric Preview Canvas + BOM Materials List
            StackPanel rightCol = new StackPanel();

            Border cardProg = UiTheme.CreateCard(new Thickness(14), new Thickness(0, 0, 0, 12));
            StackPanel spProg = new StackPanel();
            DockPanel progTop = new DockPanel { Margin = new Thickness(0, 0, 0, 6) };
            progTop.Children.Add(UiTheme.CreateText("📊 İNŞA İLERLEMESİ & İZOMETRİK ÖNİZLEME", 12, FontWeights.ExtraBold, UiTheme.AccentWhite));
            lblBuilderProgress = UiTheme.CreateText("0 / 0 Blok (%0)", 12, FontWeights.Bold, UiTheme.Green);
            lblBuilderProgress.HorizontalAlignment = HorizontalAlignment.Right;
            progTop.Children.Add(lblBuilderProgress);
            spProg.Children.Add(progTop);

            progBuilder = new ProgressBar
            {
                Minimum = 0,
                Maximum = 100,
                Value = 0,
                Height = 10,
                Background = UiTheme.BgInput,
                Foreground = UiTheme.Green,
                BorderBrush = UiTheme.BorderBrush,
                Margin = new Thickness(0, 0, 0, 6)
            };
            spProg.Children.Add(progBuilder);

            lblBuilderStatusMsg = UiTheme.CreateText("Hazır.", 11.5, FontWeights.Normal, UiTheme.TextMuted, new Thickness(0, 0, 0, 8));
            spProg.Children.Add(lblBuilderStatusMsg);

            Border canvasBorder = new Border
            {
                Background = UiTheme.BgBase,
                BorderBrush = UiTheme.BorderBrush,
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(6),
                Height = 250,
                ClipToBounds = true
            };
            canvasBuilderPreview = new Canvas { Width = 460, Height = 250, Background = UiTheme.BgBase };
            canvasBorder.Child = canvasBuilderPreview;
            spProg.Children.Add(canvasBorder);
            cardProg.Child = spProg;
            rightCol.Children.Add(cardProg);

            Border cardBom = UiTheme.CreateCard(new Thickness(14), new Thickness(0));
            StackPanel spBom = new StackPanel();
            spBom.Children.Add(UiTheme.CreateText("🧱 GEREKLİ MALZEME LİSTESİ (BOM & ENVANTER DURUMU)", 12, FontWeights.ExtraBold, UiTheme.AccentWhite, new Thickness(0, 0, 0, 8)));
            ScrollViewer svBom = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, MaxHeight = 220 };
            panelBuilderBom = new StackPanel();
            svBom.Content = panelBuilderBom;
            spBom.Children.Add(svBom);
            cardBom.Child = spBom;
            rightCol.Children.Add(cardBom);

            Grid.SetColumn(rightCol, 2);
            grid.Children.Add(rightCol);

            sv.Content = grid;
            return sv;
        }

        private void OnUploadSchematicClick(object sender, RoutedEventArgs e)
        {
            if (string.IsNullOrEmpty(selectedAccountId))
            {
                ShowToast("Lütfen önce sol menüden bir bot seçin.", "error");
                return;
            }
            WinForms.OpenFileDialog ofd = new WinForms.OpenFileDialog
            {
                Title = "Schematic / Litematic Dosyası Seçin",
                Filter = "Minecraft Şema Dosyaları (*.schem;*.schematic;*.litematic)|*.schem;*.schematic;*.litematic|Tüm Dosyalar (*.*)|*.*"
            };
            if (ofd.ShowDialog() != WinForms.DialogResult.OK) return;

            try
            {
                byte[] bytes = File.ReadAllBytes(ofd.FileName);
                string base64 = Convert.ToBase64String(bytes);
                int rot = GetSelectedBuilderRotation();
                string fileName = System.IO.Path.GetFileName(ofd.FileName);

                Dictionary<string, object> payload = new Dictionary<string, object>();
                payload["accountId"] = selectedAccountId;
                payload["filename"] = fileName;
                payload["base64Data"] = base64;
                payload["rotation"] = rot;

                pipe.SendApiAsync("POST", "/api/accounts/" + selectedAccountId + "/schematic", payload, delegate(int st, Dictionary<string, object> res)
                {
                    if (st >= 400 || JsonHelper.Str(res, "error", "") != "")
                    {
                        pipe.SendApiAsync("POST", "/api/builder/upload", payload, delegate(int st2, Dictionary<string, object> res2)
                        {
                            string err2 = JsonHelper.Str(res2, "error", "");
                            if (!string.IsNullOrEmpty(err2)) ShowToast(err2, "error");
                            else
                            {
                                ShowToast("Şema başarıyla yüklendi: " + fileName, "success");
                                FetchBuilderPreview();
                            }
                        });
                    }
                    else
                    {
                        ShowToast("Şema başarıyla yüklendi: " + fileName, "success");
                        FetchBuilderPreview();
                    }
                });
            }
            catch (Exception ex)
            {
                ShowToast("Dosya okuma hatası: " + ex.Message, "error");
            }
        }

        private void LoadBuiltInSchematicPreset(string presetId)
        {
            if (string.IsNullOrEmpty(selectedAccountId)) return;
            Dictionary<string, object> body = new Dictionary<string, object>();
            body["accountId"] = selectedAccountId;
            body["presetId"] = presetId;
            body["rotation"] = GetSelectedBuilderRotation();
            pipe.SendApiAsync("POST", "/api/builder/preset", body, delegate(int st, Dictionary<string, object> data)
            {
                string err = JsonHelper.Str(data, "error", "");
                if (!string.IsNullOrEmpty(err)) ShowToast(err, "error");
                else
                {
                    ShowToast("Hazır şablon yüklendi: " + presetId, "success");
                    FetchBuilderPreview();
                }
            });
        }

        private int GetSelectedBuilderRotation()
        {
            if (cmbBuilderRotation == null || cmbBuilderRotation.SelectedIndex < 0) return 0;
            return cmbBuilderRotation.SelectedIndex * 90;
        }

        private void OnBuilderFitCornersClick(object sender, RoutedEventArgs e)
        {
            Dictionary<string, object> pos1 = new Dictionary<string, object>
            {
                { "x", ParseIntSafe(txtBuilderP1x.Text, 0) },
                { "y", ParseIntSafe(txtBuilderP1y.Text, 64) },
                { "z", ParseIntSafe(txtBuilderP1z.Text, 0) }
            };
            Dictionary<string, object> pos2 = new Dictionary<string, object>
            {
                { "x", ParseIntSafe(txtBuilderP2x.Text, 0) },
                { "y", ParseIntSafe(txtBuilderP2y.Text, 64) },
                { "z", ParseIntSafe(txtBuilderP2z.Text, 0) }
            };
            SendSelectedBotAction("builderFitCorners", new Dictionary<string, object> { { "pos1", pos1 }, { "pos2", pos2 } });
            ShowToast("Şema iki köşe arasına oturtuldu.", "success");
            FetchBuilderPreview();
        }

        private void OnBuilderFillBoxClick(object sender, RoutedEventArgs e)
        {
            Dictionary<string, object> pos1 = new Dictionary<string, object>
            {
                { "x", ParseIntSafe(txtBuilderP1x.Text, 0) },
                { "y", ParseIntSafe(txtBuilderP1y.Text, 64) },
                { "z", ParseIntSafe(txtBuilderP1z.Text, 0) }
            };
            Dictionary<string, object> pos2 = new Dictionary<string, object>
            {
                { "x", ParseIntSafe(txtBuilderP2x.Text, 0) },
                { "y", ParseIntSafe(txtBuilderP2y.Text, 64) },
                { "z", ParseIntSafe(txtBuilderP2z.Text, 0) }
            };
            string blockName = txtBuilderFillBlock.Text.Trim();
            if (string.IsNullOrEmpty(blockName)) blockName = "dirt";
            string fillMode = cmbBuilderFillMode.SelectedItem != null ? cmbBuilderFillMode.SelectedItem.ToString() : "solid";

            SendSelectedBotAction("builderFillBox", new Dictionary<string, object>
            {
                { "pos1", pos1 },
                { "pos2", pos2 },
                { "blockName", blockName },
                { "fillMode", fillMode }
            });
            ShowToast("Özel alan şeması oluşturuldu!", "success");
            FetchBuilderPreview();
        }

        private void OnBuilderSavedPresetChanged(object sender, SelectionChangedEventArgs e)
        {
            int idx = cmbBuilderSavedPresets.SelectedIndex - 1;
            if (idx < 0 || idx >= builderPresetIds.Count) return;
            string pid = builderPresetIds[idx];
            List<object> presets = JsonHelper.Arr(JsonHelper.SubDict(appState, "config"), "builderPresets");
            for (int i = 0; i < presets.Count; i++)
            {
                Dictionary<string, object> p = JsonHelper.Dict(presets[i]);
                if (JsonHelper.Str(p, "id", "") == pid)
                {
                    Dictionary<string, object> orig = JsonHelper.SubDict(p, "origin");
                    if (orig.Count > 0)
                    {
                        txtBuilderOx.Text = JsonHelper.Int(orig, "x", 0).ToString();
                        txtBuilderOy.Text = JsonHelper.Int(orig, "y", 64).ToString();
                        txtBuilderOz.Text = JsonHelper.Int(orig, "z", 0).ToString();
                    }
                    Dictionary<string, object> p1 = JsonHelper.SubDict(p, "pos1");
                    if (p1.Count > 0)
                    {
                        txtBuilderP1x.Text = JsonHelper.Int(p1, "x", 0).ToString();
                        txtBuilderP1y.Text = JsonHelper.Int(p1, "y", 64).ToString();
                        txtBuilderP1z.Text = JsonHelper.Int(p1, "z", 0).ToString();
                    }
                    Dictionary<string, object> p2 = JsonHelper.SubDict(p, "pos2");
                    if (p2.Count > 0)
                    {
                        txtBuilderP2x.Text = JsonHelper.Int(p2, "x", 0).ToString();
                        txtBuilderP2y.Text = JsonHelper.Int(p2, "y", 64).ToString();
                        txtBuilderP2z.Text = JsonHelper.Int(p2, "z", 0).ToString();
                    }
                    break;
                }
            }
        }

        private void OnBuilderSavePresetClick(object sender, RoutedEventArgs e)
        {
            Dictionary<string, object> origin = new Dictionary<string, object>
            {
                { "x", ParseIntSafe(txtBuilderOx.Text, 0) },
                { "y", ParseIntSafe(txtBuilderOy.Text, 64) },
                { "z", ParseIntSafe(txtBuilderOz.Text, 0) }
            };
            Dictionary<string, object> pos1 = new Dictionary<string, object>
            {
                { "x", ParseIntSafe(txtBuilderP1x.Text, 0) },
                { "y", ParseIntSafe(txtBuilderP1y.Text, 64) },
                { "z", ParseIntSafe(txtBuilderP1z.Text, 0) }
            };
            Dictionary<string, object> pos2 = new Dictionary<string, object>
            {
                { "x", ParseIntSafe(txtBuilderP2x.Text, 0) },
                { "y", ParseIntSafe(txtBuilderP2y.Text, 64) },
                { "z", ParseIntSafe(txtBuilderP2z.Text, 0) }
            };
            string name = "Konum (" + origin["x"] + "," + origin["y"] + "," + origin["z"] + ")";
            SendSelectedBotAction("builderSavePreset", new Dictionary<string, object>
            {
                { "name", name },
                { "mode", "corners" },
                { "origin", origin },
                { "pos1", pos1 },
                { "pos2", pos2 },
                { "rotation", GetSelectedBuilderRotation() },
                { "delayMs", ParseIntSafe(txtBuilderDelay.Text, 220) },
                { "syncAll", true }
            });
            ShowToast("İnşa konumu kaydedildi ve tüm botlara eşitlendi!", "success");
        }

        private void OnBuilderSyncAllBotsClick(object sender, RoutedEventArgs e)
        {
            Dictionary<string, object> origin = new Dictionary<string, object>
            {
                { "x", ParseIntSafe(txtBuilderOx.Text, 0) },
                { "y", ParseIntSafe(txtBuilderOy.Text, 64) },
                { "z", ParseIntSafe(txtBuilderOz.Text, 0) }
            };
            Dictionary<string, object> pos1 = new Dictionary<string, object>
            {
                { "x", ParseIntSafe(txtBuilderP1x.Text, 0) },
                { "y", ParseIntSafe(txtBuilderP1y.Text, 64) },
                { "z", ParseIntSafe(txtBuilderP1z.Text, 0) }
            };
            Dictionary<string, object> pos2 = new Dictionary<string, object>
            {
                { "x", ParseIntSafe(txtBuilderP2x.Text, 0) },
                { "y", ParseIntSafe(txtBuilderP2y.Text, 64) },
                { "z", ParseIntSafe(txtBuilderP2z.Text, 0) }
            };
            SendSelectedBotAction("builderApplyPresetToAll", new Dictionary<string, object>
            {
                { "mode", "corners" },
                { "origin", origin },
                { "pos1", pos1 },
                { "pos2", pos2 },
                { "rotation", GetSelectedBuilderRotation() },
                { "delayMs", ParseIntSafe(txtBuilderDelay.Text, 220) }
            });
            ShowToast("Koordinatlar tüm botlara eşitlendi!", "success");
        }

        private void OnBuilderDeletePresetClick(object sender, RoutedEventArgs e)
        {
            int idx = cmbBuilderSavedPresets.SelectedIndex - 1;
            if (idx < 0 || idx >= builderPresetIds.Count) return;
            string pid = builderPresetIds[idx];
            SendSelectedBotAction("builderDeletePreset", new Dictionary<string, object> { { "id", pid } });
            ShowToast("Kayıtlı konum silindi.", "info");
        }

        private void OnBuilderStartClick(object sender, RoutedEventArgs e)
        {
            int ox = ParseIntSafe(txtBuilderOx.Text, 0);
            int oy = ParseIntSafe(txtBuilderOy.Text, 64);
            int oz = ParseIntSafe(txtBuilderOz.Text, 0);

            SendSelectedBotAction("builderUpdateConfig", new Dictionary<string, object>
            {
                { "originX", ox },
                { "originY", oy },
                { "originZ", oz },
                { "rotation", GetSelectedBuilderRotation() },
                { "delayMs", ParseIntSafe(txtBuilderDelay.Text, 220) },
                { "autoMove", chkBuilderMove.IsChecked == true },
                { "clearObstacles", chkBuilderClear.IsChecked == true },
                { "skipMissingBlocks", chkBuilderSkip.IsChecked == true },
                { "autoRestockChest", chkBuilderRestock.IsChecked == true }
            });

            SendSelectedBotAction("builderStart", new Dictionary<string, object>
            {
                { "originX", ox },
                { "originY", oy },
                { "originZ", oz }
            });
        }

        private void OnBuilderToggleChainClick(object sender, RoutedEventArgs e)
        {
            Dictionary<string, object> bot = GetSelectedBot();
            Dictionary<string, object> bld = JsonHelper.SubDict(bot, "builder");
            bool cur = JsonHelper.Bool(bld, "autoChainTillPlant", true);
            SendSelectedBotAction("builderToggleChain", new Dictionary<string, object> { { "enabled", !cur } });
        }

        private void OnToggleCooperationClick(object sender, RoutedEventArgs e)
        {
            Dictionary<string, object> cfg = JsonHelper.SubDict(appState, "config");
            Dictionary<string, object> coop = JsonHelper.SubDict(cfg, "multiBotCooperation");
            bool cur = JsonHelper.Bool(coop, "enabled", true);
            pipe.SendApiAsync("POST", "/api/cooperation/toggle", new Dictionary<string, object> { { "enabled", !cur } });
        }

        private void FetchBuilderPreview()
        {
            if (string.IsNullOrEmpty(selectedAccountId)) return;
            pipe.SendApiAsync("GET", "/api/builder/preview?accountId=" + Uri.EscapeDataString(selectedAccountId), null, delegate(int st, Dictionary<string, object> data)
            {
                if (st == 200 && data != null && data.Count > 0)
                {
                    lastBuilderPreviewData = data;
                    DrawBuilderIsometricPreview();
                }
            });
        }

        private void DrawBuilderIsometricPreview()
        {
            if (canvasBuilderPreview == null) return;
            canvasBuilderPreview.Children.Clear();

            List<object> blocks = lastBuilderPreviewData != null ? JsonHelper.Arr(lastBuilderPreviewData, "blocks") : new List<object>();
            if (blocks.Count == 0)
            {
                Dictionary<string, object> bot = GetSelectedBot();
                Dictionary<string, object> bld = JsonHelper.SubDict(bot, "builder");
                blocks = JsonHelper.Arr(bld, "layerBlocks");
            }

            if (blocks.Count == 0)
            {
                TextBlock emptyTxt = UiTheme.CreateText("Önizleme için bir .schem / .litematic yükleyin veya şablon seçin", 12.5, FontWeights.SemiBold, UiTheme.TextMuted);
                Canvas.SetLeft(emptyTxt, 45);
                Canvas.SetTop(emptyTxt, 115);
                canvasBuilderPreview.Children.Add(emptyTxt);
                return;
            }

            int sw = Math.Max(1, JsonHelper.Int(lastBuilderPreviewData, "width", 16));
            int sh = Math.Max(1, JsonHelper.Int(lastBuilderPreviewData, "height", 8));
            int sl = Math.Max(1, JsonHelper.Int(lastBuilderPreviewData, "length", 16));

            double W = 460;
            double H = 250;
            double maxSpan = Math.Max(sw + sl, Math.Max(sh * 1.6, 6));
            double tileW = Math.Max(4, Math.Min(24, Math.Floor((W * 0.72) / maxSpan)));
            double tileH = Math.Max(2, Math.Floor(tileW * 0.5));
            double blockH = Math.Max(3, Math.Floor(tileW * 0.6));
            double centerX = W / 2.0;
            double centerY = H * 0.62;

            int maxRender = Math.Min(blocks.Count, 900);
            for (int i = 0; i < maxRender; i++)
            {
                Dictionary<string, object> b = JsonHelper.Dict(blocks[i]);
                int bx = JsonHelper.Int(b, "x", 0);
                int by = JsonHelper.Int(b, "y", 0);
                int bz = JsonHelper.Int(b, "z", 0);
                bool placed = JsonHelper.Int(b, "p", 0) == 1 || JsonHelper.Bool(b, "placed", false);
                string bName = JsonHelper.Str(b, "n", "stone");

                double rx = bx - sw / 2.0;
                double rz = bz - sl / 2.0;
                double isoX = centerX + (rx - rz) * (tileW / 2.0);
                double isoY = centerY + (rx + rz) * (tileH / 2.0) - by * blockH;

                Brush fillBrush = placed ? UiTheme.Green : GetBlockBrush(bName);
                Rectangle rect = new Rectangle
                {
                    Width = Math.Max(3, tileW * 0.85),
                    Height = Math.Max(3, blockH + tileH * 0.5),
                    Fill = fillBrush,
                    Stroke = UiTheme.BgBase,
                    StrokeThickness = 0.4
                };
                Canvas.SetLeft(rect, isoX - tileW * 0.42);
                Canvas.SetTop(rect, isoY - blockH);
                canvasBuilderPreview.Children.Add(rect);
            }
        }

        // =====================================================================
        // TAB 5: KORUMA & ANTI-CHEAT SPOOFING (PRO)
        // =====================================================================
        private UIElement BuildTab5Defense()
        {
            ScrollViewer sv = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Padding = new Thickness(16) };
            StackPanel sp = new StackPanel();

            // Card 1: AutoEat, Panic Disconnect, Safe Recovery
            Border cardProt = UiTheme.CreateCard(new Thickness(16), new Thickness(0, 0, 0, 14));
            StackPanel spProt = new StackPanel();
            spProt.Children.Add(UiTheme.CreateText("🛡️ HAYATTA KALMA, OTOMATİK YEMEK & PANİK KORUMASI", 13, FontWeights.ExtraBold, UiTheme.AccentWhite, new Thickness(0, 0, 0, 10)));

            UniformGrid protGrid = new UniformGrid { Columns = 3, Margin = new Thickness(0, 0, 0, 10) };

            StackPanel spEat = new StackPanel { Margin = new Thickness(4) };
            chkDefAutoEat = UiTheme.CreateCheckBox("🍗 Otomatik Yemek Yeme (AutoEat)", true);
            spEat.Children.Add(chkDefAutoEat);
            spEat.Children.Add(UiTheme.CreateText("Açlık Eşiği (1-20)", 11, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 4, 0, 3)));
            txtDefFoodThreshold = UiTheme.CreateInput("16");
            spEat.Children.Add(txtDefFoodThreshold);
            protGrid.Children.Add(spEat);

            StackPanel spPanic = new StackPanel { Margin = new Thickness(4) };
            chkDefPanic = UiTheme.CreateCheckBox("🚨 Düşük Canda Panik Çıkışı (PanicDisconnect)", false);
            spPanic.Children.Add(chkDefPanic);
            spPanic.Children.Add(UiTheme.CreateText("Panik Can Eşiği (HP 1-19)", 11, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 4, 0, 3)));
            txtDefPanicHp = UiTheme.CreateInput("6");
            spPanic.Children.Add(txtDefPanicHp);
            protGrid.Children.Add(spPanic);

            StackPanel spSafe = new StackPanel { Margin = new Thickness(4) };
            chkDefSafeRecovery = UiTheme.CreateCheckBox("🛟 Güvenli Kurtarma & Boşluk Koruma (SafeRecovery)", true);
            spSafe.Children.Add(chkDefSafeRecovery);
            spSafe.Children.Add(UiTheme.CreateText("Düşme veya lav tehlikesinde otomatik /is veya /spawn komutu çalıştırır.", 11, FontWeights.Normal, UiTheme.TextMuted, new Thickness(0, 6, 0, 0)));
            protGrid.Children.Add(spSafe);

            spProt.Children.Add(protGrid);
            cardProt.Child = spProt;
            sp.Children.Add(cardProt);

            // Card 2: Timed AutoCommand & Join Commands
            Border cardCmds = UiTheme.CreateCard(new Thickness(16), new Thickness(0, 0, 0, 14));
            StackPanel spCmds = new StackPanel();
            spCmds.Children.Add(UiTheme.CreateText("⏱️ ZAMANLANMIŞ OTO-KOMUT & GİRİŞ KOMUTLARI", 13, FontWeights.ExtraBold, UiTheme.AccentWhite, new Thickness(0, 0, 0, 10)));

            chkDefAutoCmd = UiTheme.CreateCheckBox("Zamanlanmış Periyodik Komut Gönderimini Etkinleştir", false);
            spCmds.Children.Add(chkDefAutoCmd);

            UniformGrid cmdGrid = new UniformGrid { Columns = 2, Margin = new Thickness(0, 6, 0, 10) };
            txtDefAutoCmdText = AddLabeledInput(cmdGrid, "Otomatik Komut Metni", "/sell all");
            txtDefAutoCmdSec = AddLabeledInput(cmdGrid, "Gönderim Aralığı (Saniye)", "180");
            spCmds.Children.Add(cmdGrid);

            spCmds.Children.Add(UiTheme.CreateText("Giriş Sonrası Komutlar (Her satıra veya virgülle 1 komut)", 11.5, FontWeights.Bold, UiTheme.TextMuted, new Thickness(4, 4, 0, 4)));
            txtDefJoinCmds = new TextBox
            {
                Background = UiTheme.BgInput,
                Foreground = UiTheme.TextMain,
                CaretBrush = UiTheme.AccentWhite,
                BorderBrush = UiTheme.BorderBrush,
                BorderThickness = new Thickness(1),
                Padding = new Thickness(8),
                Height = 68,
                AcceptsReturn = true,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                FontSize = 12
            };
            spCmds.Children.Add(txtDefJoinCmds);
            cardCmds.Child = spCmds;
            sp.Children.Add(cardCmds);

            // Card 3: Client Brand & HWID Spoofing
            Border cardSpoof = UiTheme.CreateCard(new Thickness(16), new Thickness(0));
            StackPanel spSpoof = new StackPanel();
            spSpoof.Children.Add(UiTheme.CreateText("🎭 CLIENT BRAND & DONANIM KİMLİĞİ (HWID) SPOOFING", 13, FontWeights.ExtraBold, UiTheme.AccentWhite, new Thickness(0, 0, 0, 10)));

            UniformGrid spoofGrid = new UniformGrid { Columns = 3, Margin = new Thickness(0, 0, 0, 10) };

            StackPanel spBrand = new StackPanel { Margin = new Thickness(4) };
            spBrand.Children.Add(UiTheme.CreateText("Client Brand", 11, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 0, 0, 3)));
            cmbDefBrand = UiTheme.CreateComboBox(new string[] { "vanilla", "lunar", "feather", "fabric", "forge", "badlion", "optifine", "custom" }, 0);
            spBrand.Children.Add(cmbDefBrand);
            spoofGrid.Children.Add(spBrand);

            txtDefCustomBrand = AddLabeledInput(spoofGrid, "Özel Brand (custom seçiliyse)", "lunarclient:v2.15.0");

            StackPanel spLoc = new StackPanel { Margin = new Thickness(4) };
            spLoc.Children.Add(UiTheme.CreateText("İstemci Dili (Locale)", 11, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 0, 0, 3)));
            cmbDefLocale = UiTheme.CreateComboBox(new string[] { "tr_TR", "en_US", "en_GB", "de_DE" }, 0);
            spLoc.Children.Add(cmbDefLocale);
            spoofGrid.Children.Add(spLoc);

            txtDefViewDist = AddLabeledInput(spoofGrid, "Görüş Mesafesi (Chunk 4-16)", "10");

            StackPanel spHand = new StackPanel { Margin = new Thickness(4) };
            spHand.Children.Add(UiTheme.CreateText("Ana El (Main Hand)", 11, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 0, 0, 3)));
            cmbDefMainHand = UiTheme.CreateComboBox(new string[] { "right", "left" }, 0);
            spHand.Children.Add(cmbDefMainHand);
            spoofGrid.Children.Add(spHand);

            txtDefHwid = AddLabeledInput(spoofGrid, "Atanmış Sanal HWID", "HWID-XXXX-XXXX");
            txtDefHwid.IsReadOnly = true;

            spSpoof.Children.Add(spoofGrid);

            StackPanel spoofBtns = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
            spoofBtns.Children.Add(UiTheme.CreateButton("🎲 Yeni HWID Üret", "outline", delegate
            {
                SendSelectedBotAction("regenerateHwid", null);
                ShowToast("Yeni sanal HWID üretildi!", "success");
            }));
            spoofBtns.Children.Add(UiTheme.CreateButton("💾 Koruma & Spoof Ayarlarını Kaydet", "primary", OnSaveDefenseSettingsClick));
            spSpoof.Children.Add(spoofBtns);

            cardSpoof.Child = spSpoof;
            sp.Children.Add(cardSpoof);

            sv.Content = sp;
            return sv;
        }

        private void OnSaveDefenseSettingsClick(object sender, RoutedEventArgs e)
        {
            if (string.IsNullOrEmpty(selectedAccountId)) return;

            string[] rawJoin = txtDefJoinCmds.Text.Split(new char[] { '\r', '\n', ',' }, StringSplitOptions.RemoveEmptyEntries);
            List<string> joinList = new List<string>();
            for (int i = 0; i < rawJoin.Length; i++)
            {
                string s = rawJoin[i].Trim();
                if (!string.IsNullOrEmpty(s)) joinList.Add(s);
            }

            Dictionary<string, object> body = new Dictionary<string, object>();
            body["autoEat"] = chkDefAutoEat.IsChecked == true;
            body["foodThreshold"] = Math.Max(1, Math.Min(20, ParseIntSafe(txtDefFoodThreshold.Text, 16)));
            body["panicDisconnect"] = chkDefPanic.IsChecked == true;
            body["panicHealth"] = Math.Max(1, Math.Min(19, ParseIntSafe(txtDefPanicHp.Text, 6)));
            body["safeRecovery"] = chkDefSafeRecovery.IsChecked == true;
            body["autoCommandEnabled"] = chkDefAutoCmd.IsChecked == true;
            body["autoCommandText"] = txtDefAutoCmdText.Text.Trim();
            body["autoCommandIntervalSec"] = Math.Max(5, ParseIntSafe(txtDefAutoCmdSec.Text, 180));
            body["customJoinCommands"] = joinList.ToArray();
            body["clientBrand"] = cmbDefBrand.SelectedItem != null ? cmbDefBrand.SelectedItem.ToString() : "vanilla";
            body["customBrand"] = txtDefCustomBrand.Text.Trim();
            body["clientLocale"] = cmbDefLocale.SelectedItem != null ? cmbDefLocale.SelectedItem.ToString() : "tr_TR";
            body["viewDistance"] = Math.Max(4, Math.Min(16, ParseIntSafe(txtDefViewDist.Text, 10)));
            body["mainHand"] = cmbDefMainHand.SelectedItem != null ? cmbDefMainHand.SelectedItem.ToString() : "right";

            pipe.SendApiAsync("PUT", "/api/accounts/" + selectedAccountId, body, delegate
            {
                ShowToast("Koruma ve Spoofing ayarları kaydedildi!", "success");
            });
        }

        // =====================================================================
        // TAB 6: RADAR & HAREKET (PRO)
        // =====================================================================
        private UIElement BuildTab6Radar()
        {
            Grid grid = new Grid { Margin = new Thickness(16) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.25, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(14) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            // Left: Interactive Radar Canvas
            Border radarCard = UiTheme.CreateCard(new Thickness(14), new Thickness(0));
            DockPanel radarDock = new DockPanel();

            WrapPanel radarTop = new WrapPanel { Margin = new Thickness(0, 0, 0, 8) };
            radarTop.Children.Add(UiTheme.CreateButton("🗺️ 2D Üstten", "primary", delegate { radarViewMode = "2d"; RenderRadarCanvas(); }));
            radarTop.Children.Add(UiTheme.CreateButton("🧊 3D İzometrik", "outline", delegate { radarViewMode = "3d"; RenderRadarCanvas(); }));

            radarTop.Children.Add(UiTheme.CreateText("  Yarıçap: ", 11.5, FontWeights.Bold, UiTheme.TextMuted));
            sliderRadarRadius = new Slider { Minimum = 8, Maximum = 18, Value = 12, Width = 90, VerticalAlignment = VerticalAlignment.Center };
            lblRadarRadiusVal = UiTheme.CreateText("12", 11.5, FontWeights.Bold, UiTheme.AccentWhite, new Thickness(4, 0, 8, 0));
            sliderRadarRadius.ValueChanged += delegate
            {
                if (lblRadarRadiusVal != null) lblRadarRadiusVal.Text = ((int)sliderRadarRadius.Value).ToString();
            };
            radarTop.Children.Add(sliderRadarRadius);
            radarTop.Children.Add(lblRadarRadiusVal);

            cmbRadarSliceMode = UiTheme.CreateComboBox(new string[] { "Yüzey", "Kesit" }, 0);
            cmbRadarSliceMode.Width = 90;
            radarTop.Children.Add(cmbRadarSliceMode);
            radarTop.Children.Add(UiTheme.CreateButton("🔄 Yenile", "outline", delegate { FetchRadarSnapshot(); }));
            DockPanel.SetDock(radarTop, Dock.Top);
            radarDock.Children.Add(radarTop);

            lblRadarHover = UiTheme.CreateText("Blok üzerine tıklayarak botun o koordinata bakmasını (lookAtCoords) sağlayabilirsiniz.", 11.5, FontWeights.Normal, UiTheme.TextMuted, new Thickness(0, 6, 0, 0));
            DockPanel.SetDock(lblRadarHover, Dock.Bottom);
            radarDock.Children.Add(lblRadarHover);

            Border canvasHost = new Border
            {
                Background = UiTheme.BgBase,
                BorderBrush = UiTheme.BorderBrush,
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(6),
                ClipToBounds = true
            };
            canvasRadar = new Canvas { Width = 520, Height = 420, Background = UiTheme.BgBase, Cursor = Cursors.Cross };
            canvasRadar.MouseMove += OnRadarCanvasMouseMove;
            canvasRadar.MouseLeftButtonDown += OnRadarCanvasMouseDown;
            canvasHost.Child = canvasRadar;
            radarDock.Children.Add(canvasHost);

            radarCard.Child = radarDock;
            Grid.SetColumn(radarCard, 0);
            grid.Children.Add(radarCard);

            // Right: 3x3 WASD Movement D-Pad, 3x3 Camera Look D-Pad, Nearby Entities
            StackPanel rightStack = new StackPanel();

            Border padCard = UiTheme.CreateCard(new Thickness(14), new Thickness(0, 0, 0, 12));
            StackPanel spPads = new StackPanel();
            spPads.Children.Add(UiTheme.CreateText("🎮 3x3 HAREKET (WASD) & KAMERA BAKIŞ KONTROLÜ", 12, FontWeights.ExtraBold, UiTheme.AccentWhite, new Thickness(0, 0, 0, 10)));

            UniformGrid twoPads = new UniformGrid { Columns = 2 };

            // 3x3 WASD D-Pad
            UniformGrid wasdGrid = new UniformGrid { Rows = 3, Columns = 3, Margin = new Thickness(0, 0, 6, 0) };
            wasdGrid.Children.Add(UiTheme.CreateButton("⬆️ Zıpla", "outline", delegate { SendSelectedBotAction("jump", null); }));
            wasdGrid.Children.Add(UiTheme.CreateButton("▲ İleri (W)", "primary", delegate { SendMoveStep("forward"); }));
            wasdGrid.Children.Add(UiTheme.CreateButton("🦵 Eğil", "outline", delegate { SendSelectedBotAction("toggleSneak", null); }));
            wasdGrid.Children.Add(UiTheme.CreateButton("◀ Sol (A)", "primary", delegate { SendMoveStep("left"); }));
            wasdGrid.Children.Add(UiTheme.CreateButton("⏹ Dur", "danger", delegate { SendSelectedBotAction("stopMove", null); }));
            wasdGrid.Children.Add(UiTheme.CreateButton("▶ Sağ (D)", "primary", delegate { SendMoveStep("right"); }));
            wasdGrid.Children.Add(UiTheme.CreateButton("👋 Salla", "outline", delegate { SendSelectedBotAction("swing", null); }));
            wasdGrid.Children.Add(UiTheme.CreateButton("▼ Geri (S)", "primary", delegate { SendMoveStep("back"); }));
            wasdGrid.Children.Add(UiTheme.CreateButton("🖱️ Sağ Tık", "outline", delegate { SendSelectedBotAction("useHeldItem", null); }));
            twoPads.Children.Add(wasdGrid);

            // 3x3 Camera Look D-Pad
            UniformGrid lookGrid = new UniformGrid { Rows = 3, Columns = 3, Margin = new Thickness(6, 0, 0, 0) };
            lookGrid.Children.Add(UiTheme.CreateButton("↖", "outline", delegate { SendLookDelta(-30, 15, false); }));
            lookGrid.Children.Add(UiTheme.CreateButton("🔼 Yukarı", "indigo", delegate { SendLookDelta(0, 20, false); }));
            lookGrid.Children.Add(UiTheme.CreateButton("↗", "outline", delegate { SendLookDelta(30, 15, false); }));
            lookGrid.Children.Add(UiTheme.CreateButton("◀ Sola Bak", "indigo", delegate { SendLookDelta(-45, 0, false); }));
            lookGrid.Children.Add(UiTheme.CreateButton("🎯 Sıfırla", "outline", delegate { SendLookDelta(0, 0, true); }));
            lookGrid.Children.Add(UiTheme.CreateButton("▶ Sağa Bak", "indigo", delegate { SendLookDelta(45, 0, false); }));
            lookGrid.Children.Add(UiTheme.CreateButton("↙", "outline", delegate { SendLookDelta(-30, -15, false); }));
            lookGrid.Children.Add(UiTheme.CreateButton("🔽 Aşağı", "indigo", delegate { SendLookDelta(0, -20, false); }));
            lookGrid.Children.Add(UiTheme.CreateButton("↘", "outline", delegate { SendLookDelta(30, -15, false); }));
            twoPads.Children.Add(lookGrid);

            spPads.Children.Add(twoPads);
            padCard.Child = spPads;
            rightStack.Children.Add(padCard);

            // Nearby Entities List
            Border entCard = UiTheme.CreateCard(new Thickness(14), new Thickness(0));
            StackPanel spEnt = new StackPanel();
            spEnt.Children.Add(UiTheme.CreateText("📡 YAKINDAKİ VARLIKLAR & OYUNCULAR (ENTITIES)", 12, FontWeights.ExtraBold, UiTheme.AccentWhite, new Thickness(0, 0, 0, 8)));
            ScrollViewer svEnt = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Height = 235 };
            panelRadarEntities = new StackPanel();
            svEnt.Content = panelRadarEntities;
            spEnt.Children.Add(svEnt);
            entCard.Child = spEnt;
            rightStack.Children.Add(entCard);

            Grid.SetColumn(rightStack, 2);
            grid.Children.Add(rightStack);
            return grid;
        }

        private void SendMoveStep(string dir)
        {
            SendSelectedBotAction("moveStep", new Dictionary<string, object> { { "direction", dir }, { "duration", 450 } });
        }

        private void SendLookDelta(double dYaw, double dPitch, bool resetPitch)
        {
            SendSelectedBotAction("lookDelta", new Dictionary<string, object> { { "dYaw", dYaw }, { "dPitch", dPitch }, { "resetPitch", resetPitch } });
        }

        private void FetchRadarSnapshot()
        {
            if (string.IsNullOrEmpty(selectedAccountId)) return;
            int radius = sliderRadarRadius != null ? (int)sliderRadarRadius.Value : 12;
            string mode = (cmbRadarSliceMode != null && cmbRadarSliceMode.SelectedIndex == 1) ? "slice" : "surface";
            string url = string.Format("/api/radar?accountId={0}&radius={1}&mode={2}", Uri.EscapeDataString(selectedAccountId), radius, mode);
            pipe.SendApiAsync("GET", url, null, delegate(int st, Dictionary<string, object> data)
            {
                if (st == 200 && data != null && data.Count > 0)
                {
                    lastRadarSnapshot = data;
                    RenderRadarCanvas();
                    RenderRadarEntities();
                }
            });
        }

        private void RenderRadarCanvas()
        {
            if (canvasRadar == null) return;
            canvasRadar.Children.Clear();
            radarHitCells.Clear();

            if (lastRadarSnapshot == null || !JsonHelper.Bool(lastRadarSnapshot, "online", true) && JsonHelper.Arr(lastRadarSnapshot, "grid").Count == 0)
            {
                TextBlock tb = UiTheme.CreateText("Bot çevrimiçi olduğunda canlı radar haritası burada görüntülenir.", 12.5, FontWeights.SemiBold, UiTheme.TextMuted);
                Canvas.SetLeft(tb, 65);
                Canvas.SetTop(tb, 195);
                canvasRadar.Children.Add(tb);
                return;
            }

            int R = Math.Max(4, JsonHelper.Int(lastRadarSnapshot, "radius", 12));
            List<object> gridRows = JsonHelper.Arr(lastRadarSnapshot, "grid");
            Dictionary<string, object> botPos = JsonHelper.SubDict(lastRadarSnapshot, "bot");
            int bx = JsonHelper.Int(botPos, "x", 0);
            int by = JsonHelper.Int(botPos, "y", 64);
            int bz = JsonHelper.Int(botPos, "z", 0);

            int gridSize = R * 2 + 1;
            double W = 520;
            double H = 420;

            if (radarViewMode == "2d")
            {
                double cell = Math.Floor(Math.Min(W, H) / gridSize);
                double offX = (W - cell * gridSize) / 2.0;
                double offY = (H - cell * gridSize) / 2.0;

                for (int rz = 0; rz < gridRows.Count && rz < gridSize; rz++)
                {
                    List<object> row = JsonHelper.ToList(gridRows[rz]);
                    for (int rx = 0; rx < row.Count && rx < gridSize; rx++)
                    {
                        Dictionary<string, object> item = JsonHelper.Dict(row[rx]);
                        string bName = JsonHelper.Str(item, "n", "air");
                        int relY = JsonHelper.Int(item, "y", 0);
                        double x = offX + rx * cell;
                        double y = offY + rz * cell;

                        Rectangle rect = new Rectangle
                        {
                            Width = Math.Max(2, cell - 1),
                            Height = Math.Max(2, cell - 1),
                            Fill = GetBlockBrush(bName)
                        };
                        Canvas.SetLeft(rect, x);
                        Canvas.SetTop(rect, y);
                        canvasRadar.Children.Add(rect);

                        radarHitCells.Add(new RadarHitCell
                        {
                            X1 = x,
                            Y1 = y,
                            X2 = x + cell,
                            Y2 = y + cell,
                            Wx = bx + (rx - R),
                            Wy = by + relY,
                            Wz = bz + (rz - R),
                            BlockName = bName
                        });
                    }
                }

                // Draw Bot Center Marker
                Ellipse botDot = new Ellipse
                {
                    Width = 10,
                    Height = 10,
                    Fill = UiTheme.AccentWhite,
                    Stroke = UiTheme.AccentBlack,
                    StrokeThickness = 2
                };
                Canvas.SetLeft(botDot, offX + R * cell + cell / 2.0 - 5);
                Canvas.SetTop(botDot, offY + R * cell + cell / 2.0 - 5);
                canvasRadar.Children.Add(botDot);
            }
            else
            {
                double tileW = Math.Max(12, Math.Floor((W - 40) / gridSize));
                double tileH = Math.Floor(tileW * 0.5);
                double cubeH = Math.Floor(tileH * 0.85);
                double originX = W / 2.0;
                double originY = H * 0.25;

                for (int rz = 0; rz < gridRows.Count && rz < gridSize; rz++)
                {
                    List<object> row = JsonHelper.ToList(gridRows[rz]);
                    for (int rx = 0; rx < row.Count && rx < gridSize; rx++)
                    {
                        Dictionary<string, object> item = JsonHelper.Dict(row[rx]);
                        string bName = JsonHelper.Str(item, "n", "air");
                        int relY = JsonHelper.Int(item, "y", 0);
                        if (bName == "air") continue;

                        double isoX = originX + (rx - rz) * (tileW / 2.0);
                        double isoY = originY + (rx + rz) * (tileH / 2.0) - relY * (cubeH * 0.65);

                        Rectangle rect = new Rectangle
                        {
                            Width = Math.Max(3, tileW * 0.85),
                            Height = Math.Max(3, cubeH + tileH * 0.5),
                            Fill = GetBlockBrush(bName),
                            Stroke = UiTheme.BgBase,
                            StrokeThickness = 0.4
                        };
                        Canvas.SetLeft(rect, isoX - tileW * 0.42);
                        Canvas.SetTop(rect, isoY - cubeH);
                        canvasRadar.Children.Add(rect);

                        radarHitCells.Add(new RadarHitCell
                        {
                            X1 = isoX - tileW * 0.42,
                            Y1 = isoY - cubeH,
                            X2 = isoX + tileW * 0.42,
                            Y2 = isoY + tileH * 0.5,
                            Wx = bx + (rx - R),
                            Wy = by + relY,
                            Wz = bz + (rz - R),
                            BlockName = bName
                        });
                    }
                }
            }
        }

        private void RenderRadarEntities()
        {
            if (panelRadarEntities == null) return;
            panelRadarEntities.Children.Clear();
            List<object> entities = lastRadarSnapshot != null ? JsonHelper.Arr(lastRadarSnapshot, "entities") : new List<object>();
            if (entities.Count == 0)
            {
                panelRadarEntities.Children.Add(UiTheme.CreateText("Yakında oyuncu veya varlık bulunmuyor.", 12, FontWeights.Normal, UiTheme.TextMuted));
                return;
            }
            for (int i = 0; i < entities.Count; i++)
            {
                Dictionary<string, object> ent = JsonHelper.Dict(entities[i]);
                string label = JsonHelper.Str(ent, "label", "Varlık");
                string cat = JsonHelper.Str(ent, "category", "passive");
                double dist = JsonHelper.Dbl(ent, "distance", 0.0);
                Brush c = cat == "player" ? UiTheme.Green : (cat == "hostile" ? UiTheme.Red : UiTheme.Yellow);

                Border row = UiTheme.CreateCard(new Thickness(8, 5, 8, 5), new Thickness(0, 0, 0, 4));
                DockPanel dp = new DockPanel();
                dp.Children.Add(UiTheme.CreateText("● " + label, 12, FontWeights.Bold, c));
                TextBlock r = UiTheme.CreateText(dist.ToString("0.0") + "m", 11.5, FontWeights.SemiBold, UiTheme.TextMuted);
                r.HorizontalAlignment = HorizontalAlignment.Right;
                dp.Children.Add(r);
                row.Child = dp;
                panelRadarEntities.Children.Add(row);
            }
        }

        private RadarHitCell FindRadarHitCell(Point pt)
        {
            for (int i = radarHitCells.Count - 1; i >= 0; i--)
            {
                RadarHitCell c = radarHitCells[i];
                if (pt.X >= c.X1 && pt.X <= c.X2 && pt.Y >= c.Y1 && pt.Y <= c.Y2) return c;
            }
            return null;
        }

        private void OnRadarCanvasMouseMove(object sender, MouseEventArgs e)
        {
            RadarHitCell hit = FindRadarHitCell(e.GetPosition(canvasRadar));
            if (hit != null && lblRadarHover != null)
            {
                lblRadarHover.Text = string.Format("Blok: {0}  •  Konum: X:{1} Y:{2} Z:{3} (Bakmak için tıklayın)", hit.BlockName, hit.Wx, hit.Wy, hit.Wz);
            }
        }

        private void OnRadarCanvasMouseDown(object sender, MouseButtonEventArgs e)
        {
            RadarHitCell hit = FindRadarHitCell(e.GetPosition(canvasRadar));
            if (hit != null)
            {
                SendSelectedBotAction("lookAtCoords", new Dictionary<string, object>
                {
                    { "x", hit.Wx },
                    { "y", hit.Wy },
                    { "z", hit.Wz }
                });
                ShowToast(string.Format("Bot X:{0} Y:{1} Z:{2} bloğuna döndü.", hit.Wx, hit.Wy, hit.Wz), "info");
            }
        }

        private Brush GetBlockBrush(string blockName)
        {
            if (string.IsNullOrEmpty(blockName) || blockName == "air") return UiTheme.BrushRgba(255, 255, 255, 8);
            string n = blockName.ToLowerInvariant();
            if (n.Contains("water")) return UiTheme.BrushHex("#2563EB");
            if (n.Contains("lava") || n.Contains("fire")) return UiTheme.BrushHex("#EA580C");
            if (n.Contains("grass") || n.Contains("leaves") || n.Contains("cactus") || n.Contains("melon") || n.Contains("sugar_cane")) return UiTheme.BrushHex("#16A34A");
            if (n.Contains("dirt") || n.Contains("farmland") || n.Contains("podzol") || n.Contains("soul_sand")) return UiTheme.BrushHex("#854D0E");
            if (n.Contains("sand") || n.Contains("wheat") || n.Contains("glowstone") || n.Contains("gold") || n.Contains("hay")) return UiTheme.BrushHex("#EAB308");
            if (n.Contains("pumpkin") || n.Contains("jack_o_lantern") || n.Contains("copper") || n.Contains("terracotta")) return UiTheme.BrushHex("#F97316");
            if (n.Contains("chest") || n.Contains("barrel") || n.Contains("log") || n.Contains("planks") || n.Contains("wood")) return UiTheme.BrushHex("#A16207");
            if (n.Contains("spawner") || n.Contains("obsidian")) return UiTheme.BrushHex("#7C3AED");
            if (n.Contains("diamond") || n.Contains("ice")) return UiTheme.BrushHex("#06B6D4");
            if (n.Contains("redstone") || n.Contains("netherrack") || n.Contains("poppy")) return UiTheme.BrushHex("#DC2626");
            return UiTheme.BrushHex("#64748B");
        }

        // =====================================================================
        // TAB 7: GENEL AYARLAR (ALL 9 CATEGORIES)
        // =====================================================================
        private UIElement BuildTab7Settings()
        {
            DockPanel dock = new DockPanel { Margin = new Thickness(16) };

            // Bottom Save Bar
            Border footerBar = UiTheme.CreateCard(new Thickness(14, 10, 14, 10), new Thickness(0, 10, 0, 0));
            DockPanel footerDock = new DockPanel();
            footerDock.Children.Add(UiTheme.CreateText("Tüm 9 genel ayar kategorisi yerel motor (config.json) ile senkronizedir.", 12, FontWeights.Medium, UiTheme.TextMuted));
            StackPanel footerBtns = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
            footerBtns.Children.Add(UiTheme.CreateButton("🔄 Değişiklikleri Sıfırla", "outline", delegate { PopulateSettingsInputsFromState(); }));
            footerBtns.Children.Add(UiTheme.CreateButton("💾 Tüm Genel Ayarları Kaydet", "primary", OnSaveAllGeneralSettingsClick, new Thickness(16, 8, 16, 8)));
            footerDock.Children.Add(footerBtns);
            footerBar.Child = footerDock;
            DockPanel.SetDock(footerBar, Dock.Bottom);
            dock.Children.Add(footerBar);

            ScrollViewer sv = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
            StackPanel sp = new StackPanel();

            // Category 1: Sunucu Ayarları
            Border c1 = UiTheme.CreateCard(new Thickness(16), new Thickness(0, 0, 0, 12));
            StackPanel sp1 = new StackPanel();
            sp1.Children.Add(UiTheme.CreateText("1. 🌐 SUNUCU AYARLARI (HOST, PORT, SÜRÜM)", 13, FontWeights.ExtraBold, UiTheme.AccentWhite, new Thickness(0, 0, 0, 8)));
            UniformGrid g1 = new UniformGrid { Columns = 4 };
            txtSetHost = AddLabeledInput(g1, "Sunucu Adresi (Host)", "localhost");
            txtSetPort = AddLabeledInput(g1, "Port", "25565");
            StackPanel spVer = new StackPanel { Margin = new Thickness(4) };
            spVer.Children.Add(UiTheme.CreateText("Minecraft Sürümü", 11, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 0, 0, 3)));
            cmbSetVersion = UiTheme.CreateComboBox(new string[] { "auto", "1.21.1", "1.20.4", "1.20.1", "1.19.4", "1.18.2", "1.16.5", "1.12.2", "1.8.9", "custom" }, 0);
            spVer.Children.Add(cmbSetVersion);
            g1.Children.Add(spVer);
            txtSetCustomVer = AddLabeledInput(g1, "Özel Sürüm (custom ise)", "");
            sp1.Children.Add(g1);
            c1.Child = sp1;
            sp.Children.Add(c1);

            // Category 2: Otomatik Giriş (autoAuth)
            Border c2 = UiTheme.CreateCard(new Thickness(16), new Thickness(0, 0, 0, 12));
            StackPanel sp2 = new StackPanel();
            sp2.Children.Add(UiTheme.CreateText("2. 🔑 OTOMATİK GİRİŞ & KAYIT (AUTO-AUTH)", 13, FontWeights.ExtraBold, UiTheme.AccentWhite, new Thickness(0, 0, 0, 8)));
            StackPanel authChecks = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 6) };
            chkSetAuthEnabled = UiTheme.CreateCheckBox("Otomatik Giriş/Kayıt Sistemi Aktif", true);
            chkSetAuthSmart = UiTheme.CreateCheckBox("Akıllı Sohbet Algılama (/login & /register istemini bekle)", true);
            authChecks.Children.Add(chkSetAuthEnabled);
            authChecks.Children.Add(chkSetAuthSmart);
            sp2.Children.Add(authChecks);
            UniformGrid g2 = new UniformGrid { Columns = 3 };
            txtSetAuthDelay = AddLabeledInput(g2, "Giriş Gecikmesi (ms)", "1500");
            txtSetLoginCmd = AddLabeledInput(g2, "Login Komut Şablonu", "/login {password}");
            txtSetRegCmd = AddLabeledInput(g2, "Register Komut Şablonu", "/register {password} {email}");
            sp2.Children.Add(g2);
            c2.Child = sp2;
            sp.Children.Add(c2);

            // Category 3: Anti-AFK & Yeniden Bağlanma
            Border c3 = UiTheme.CreateCard(new Thickness(16), new Thickness(0, 0, 0, 12));
            StackPanel sp3 = new StackPanel();
            sp3.Children.Add(UiTheme.CreateText("3. 🔄 ANTI-AFK & OTOMATİK YENİDEN BAĞLANMA", 13, FontWeights.ExtraBold, UiTheme.AccentWhite, new Thickness(0, 0, 0, 8)));
            UniformGrid g3 = new UniformGrid { Columns = 2 };
            StackPanel spAfk = new StackPanel { Margin = new Thickness(4) };
            chkSetAfkEnabled = UiTheme.CreateCheckBox("Anti-AFK Hareket Döngüsü Etkin", true);
            spAfk.Children.Add(chkSetAfkEnabled);
            spAfk.Children.Add(UiTheme.CreateText("Anti-AFK Aralığı (Saniye)", 11, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 4, 0, 3)));
            txtSetAfkSec = UiTheme.CreateInput("15");
            spAfk.Children.Add(txtSetAfkSec);
            g3.Children.Add(spAfk);

            StackPanel spRec = new StackPanel { Margin = new Thickness(4) };
            chkSetRecEnabled = UiTheme.CreateCheckBox("Sunucudan Düşünce Otomatik Yeniden Bağlan", true);
            spRec.Children.Add(chkSetRecEnabled);
            spRec.Children.Add(UiTheme.CreateText("Yeniden Bağlanma Bekleme Süresi (Saniye)", 11, FontWeights.Bold, UiTheme.TextMuted, new Thickness(0, 4, 0, 3)));
            txtSetRecSec = UiTheme.CreateInput("5");
            spRec.Children.Add(txtSetRecSec);
            g3.Children.Add(spRec);
            sp3.Children.Add(g3);
            c3.Child = sp3;
            sp.Children.Add(c3);

            // Category 4: Discord Webhook
            Border c4 = UiTheme.CreateCard(new Thickness(16), new Thickness(0, 0, 0, 12));
            StackPanel sp4 = new StackPanel();
            sp4.Children.Add(UiTheme.CreateText("4. 💬 DISCORD WEBHOOK BİLDİRİMLERİ", 13, FontWeights.ExtraBold, UiTheme.AccentWhite, new Thickness(0, 0, 0, 8)));
            chkSetWebhookEnabled = UiTheme.CreateCheckBox("Discord Webhook Bildirimlerini Etkinleştir", false);
            sp4.Children.Add(chkSetWebhookEnabled);
            DockPanel whRow = new DockPanel { Margin = new Thickness(0, 6, 0, 8) };
            Button btnTestWh = UiTheme.CreateButton("🔔 Test Bildirimi Gönder", "indigo", OnTestWebhookClick);
            DockPanel.SetDock(btnTestWh, Dock.Right);
            whRow.Children.Add(btnTestWh);
            txtSetWebhookUrl = UiTheme.CreateInput("", "https://discord.com/api/webhooks/...");
            txtSetWebhookUrl.Margin = new Thickness(0, 0, 8, 0);
            whRow.Children.Add(txtSetWebhookUrl);
            sp4.Children.Add(whRow);
            UniformGrid whChecks = new UniformGrid { Columns = 4 };
            chkSetWhDisconnect = UiTheme.CreateCheckBox("Bağlantı Kopması", true);
            chkSetWhPanic = UiTheme.CreateCheckBox("Panik Çıkışı", true);
            chkSetWhDeath = UiTheme.CreateCheckBox("Bot Ölümü", true);
            chkSetWhCaptcha = UiTheme.CreateCheckBox("Captcha Уyarısı", true);
            whChecks.Children.Add(chkSetWhDisconnect);
            whChecks.Children.Add(chkSetWhPanic);
            whChecks.Children.Add(chkSetWhDeath);
            whChecks.Children.Add(chkSetWhCaptcha);
            sp4.Children.Add(whChecks);
            c4.Child = sp4;
            sp.Children.Add(c4);

            // Category 5: Sesli & Masaüstü Bildirimler
            Border c5 = UiTheme.CreateCard(new Thickness(16), new Thickness(0, 0, 0, 12));
            StackPanel sp5 = new StackPanel();
            sp5.Children.Add(UiTheme.CreateText("5. 🔊 YEREL SESLİ SENTEZLEYİCİ & MASAÜSTÜ BİLDİRİMLERİ", 13, FontWeights.ExtraBold, UiTheme.AccentWhite, new Thickness(0, 0, 0, 8)));
            chkSetSoundEnabled = UiTheme.CreateCheckBox("Sesli Uyarıları Etkinleştir (RIFF/WAV Sentezleyici)", true);
            sp5.Children.Add(chkSetSoundEnabled);

            WrapPanel sndCtrlRow = new WrapPanel { Margin = new Thickness(0, 6, 0, 8) };
            sndCtrlRow.Children.Add(UiTheme.CreateText("Ses Teması: ", 12, FontWeights.Bold, UiTheme.TextMuted));
            cmbSetSoundTheme = UiTheme.CreateComboBox(new string[] { "cyber", "chime", "arcade", "radar", "subtle" }, 0);
            cmbSetSoundTheme.Width = 110;
            sndCtrlRow.Children.Add(cmbSetSoundTheme);

            sndCtrlRow.Children.Add(UiTheme.CreateText("   Ses Seviyesi: ", 12, FontWeights.Bold, UiTheme.TextMuted));
            sliderSetSoundVol = new Slider { Minimum = 0, Maximum = 100, Value = 35, Width = 120, VerticalAlignment = VerticalAlignment.Center };
            lblSetSoundVol = UiTheme.CreateText("%35", 12, FontWeights.Bold, UiTheme.AccentWhite, new Thickness(6, 0, 12, 0));
            sliderSetSoundVol.ValueChanged += delegate
            {
                if (lblSetSoundVol != null) lblSetSoundVol.Text = "%" + ((int)sliderSetSoundVol.Value);
            };
            sndCtrlRow.Children.Add(sliderSetSoundVol);
            sndCtrlRow.Children.Add(lblSetSoundVol);

            cmbSetSoundTestType = UiTheme.CreateComboBox(new string[] { "mention", "damage", "disconnect", "captcha", "notify" }, 0);
            cmbSetSoundTestType.Width = 110;
            sndCtrlRow.Children.Add(cmbSetSoundTestType);

            sndCtrlRow.Children.Add(UiTheme.CreateButton("🔊 Sesi Test Et", "primary", delegate
            {
                string th = cmbSetSoundTheme.SelectedItem != null ? cmbSetSoundTheme.SelectedItem.ToString() : "cyber";
                string tp = cmbSetSoundTestType.SelectedItem != null ? cmbSetSoundTestType.SelectedItem.ToString() : "mention";
                int vol = (int)sliderSetSoundVol.Value;
                SctSoundSynthesizer.PlayAlertSound(tp, th, vol);
            }));
            sp5.Children.Add(sndCtrlRow);

            UniformGrid sndChecks = new UniformGrid { Columns = 5, Margin = new Thickness(0, 0, 0, 8) };
            chkSetSndDamage = UiTheme.CreateCheckBox("Hasar Ses", true);
            chkSetSndDisconnect = UiTheme.CreateCheckBox("Kopma Ses", true);
            chkSetSndMention = UiTheme.CreateCheckBox("Etiket Ses", true);
            chkSetSndCaptcha = UiTheme.CreateCheckBox("Captcha Ses", true);
            chkSetSndNotify = UiTheme.CreateCheckBox("Genel Bildirim", true);
            sndChecks.Children.Add(chkSetSndDamage);
            sndChecks.Children.Add(chkSetSndDisconnect);
            sndChecks.Children.Add(chkSetSndMention);
            sndChecks.Children.Add(chkSetSndCaptcha);
            sndChecks.Children.Add(chkSetSndNotify);
            sp5.Children.Add(sndChecks);

            UniformGrid deskChecks = new UniformGrid { Columns = 5 };
            chkSetDeskEnabled = UiTheme.CreateCheckBox("Masaüstü Bildirim", true);
            chkSetDeskMention = UiTheme.CreateCheckBox("Etiket (Mention)", true);
            chkSetDeskDisconnect = UiTheme.CreateCheckBox("Kopma", true);
            chkSetDeskDeath = UiTheme.CreateCheckBox("Ölüm", true);
            chkSetDeskCaptcha = UiTheme.CreateCheckBox("Captcha", true);
            deskChecks.Children.Add(chkSetDeskEnabled);
            deskChecks.Children.Add(chkSetDeskMention);
            deskChecks.Children.Add(chkSetDeskDisconnect);
            deskChecks.Children.Add(chkSetDeskDeath);
            deskChecks.Children.Add(chkSetDeskCaptcha);
            sp5.Children.Add(deskChecks);
            c5.Child = sp5;
            sp.Children.Add(c5);

            // Category 6: Discord Rich Presence (discordRpc)
            Border c6 = UiTheme.CreateCard(new Thickness(16), new Thickness(0, 0, 0, 12));
            StackPanel sp6 = new StackPanel();
            sp6.Children.Add(UiTheme.CreateText("6. 🎮 DISCORD RICH PRESENCE (PROFİL AKTİVİTESİ)", 13, FontWeights.ExtraBold, UiTheme.AccentWhite, new Thickness(0, 0, 0, 8)));
            chkSetRpcEnabled = UiTheme.CreateCheckBox("Discord Rich Presence (RPC) Durum Gösterimini Etkinleştir", true);
            sp6.Children.Add(chkSetRpcEnabled);

            UniformGrid rpcChecks = new UniformGrid { Columns = 5, Margin = new Thickness(0, 6, 0, 8) };
            chkSetRpcServer = UiTheme.CreateCheckBox("Sunucu IP", true);
            chkSetRpcMode = UiTheme.CreateCheckBox("Çalışma Modu", true);
            chkSetRpcStats = UiTheme.CreateCheckBox("Kazılan Blok", true);
            chkSetRpcCrops = UiTheme.CreateCheckBox("Hasat Sayısı", true);
            chkSetRpcMobs = UiTheme.CreateCheckBox("Kesilen Mob", true);
            chkSetRpcChests = UiTheme.CreateCheckBox("Sandık Sayısı", true);
            chkSetRpcCaptchas = UiTheme.CreateCheckBox("Captcha", false);
            chkSetRpcBuilder = UiTheme.CreateCheckBox("Oto-İnşa %", true);
            chkSetRpcHealth = UiTheme.CreateCheckBox("Can/Açlık", false);
            chkSetRpcPing = UiTheme.CreateCheckBox("Ping", false);
            chkSetRpcCoords = UiTheme.CreateCheckBox("Koordinatlar", false);
            chkSetRpcAccount = UiTheme.CreateCheckBox("Hesap Adı", false);
            chkSetRpcAvatar = UiTheme.CreateCheckBox("Avatar İkonu", true);
            chkSetRpcTime = UiTheme.CreateCheckBox("Geçen Süre", true);
            rpcChecks.Children.Add(chkSetRpcServer);
            rpcChecks.Children.Add(chkSetRpcMode);
            rpcChecks.Children.Add(chkSetRpcStats);
            rpcChecks.Children.Add(chkSetRpcCrops);
            rpcChecks.Children.Add(chkSetRpcMobs);
            rpcChecks.Children.Add(chkSetRpcChests);
            rpcChecks.Children.Add(chkSetRpcCaptchas);
            rpcChecks.Children.Add(chkSetRpcBuilder);
            rpcChecks.Children.Add(chkSetRpcHealth);
            rpcChecks.Children.Add(chkSetRpcPing);
            rpcChecks.Children.Add(chkSetRpcCoords);
            rpcChecks.Children.Add(chkSetRpcAccount);
            rpcChecks.Children.Add(chkSetRpcAvatar);
            rpcChecks.Children.Add(chkSetRpcTime);
            sp6.Children.Add(rpcChecks);

            UniformGrid rpcInputs = new UniformGrid { Columns = 4 };
            txtSetRpcDetails = AddLabeledInput(rpcInputs, "Özel Üst Satır (Details)", "");
            txtSetRpcState = AddLabeledInput(rpcInputs, "Özel Alt Satır (State)", "");
            txtSetRpcClientId = AddLabeledInput(rpcInputs, "Discord Client ID", "450485984333660181");
            txtSetRpcImage = AddLabeledInput(rpcInputs, "Büyük Logo URL", "");
            txtSetRpcBtn1Label = AddLabeledInput(rpcInputs, "Buton 1 Başlık", "");
            txtSetRpcBtn1Url = AddLabeledInput(rpcInputs, "Buton 1 URL", "");
            txtSetRpcBtn2Label = AddLabeledInput(rpcInputs, "Buton 2 Başlık", "");
            txtSetRpcBtn2Url = AddLabeledInput(rpcInputs, "Buton 2 URL", "");
            sp6.Children.Add(rpcInputs);
            c6.Child = sp6;
            sp.Children.Add(c6);

            // Category 7: Çoklu Bot Ortak Çalışma
            Border c7 = UiTheme.CreateCard(new Thickness(16), new Thickness(0, 0, 0, 12));
            StackPanel sp7 = new StackPanel();
            sp7.Children.Add(UiTheme.CreateText("7. 🤝 ÇOKLU BOT ORTAK ÇALIŞMA & İŞ PAYLAŞIMI (MULTI-BOT COOP)", 13, FontWeights.ExtraBold, UiTheme.AccentWhite, new Thickness(0, 0, 0, 8)));
            UniformGrid coopChecks = new UniformGrid { Columns = 5 };
            chkSetCoopEnabled = UiTheme.CreateCheckBox("Ortak Çalışma Aktif", true);
            chkSetCoopBuilder = UiTheme.CreateCheckBox("Oto-İnşa Senkron", true);
            chkSetCoopTill = UiTheme.CreateCheckBox("Çapalama Senkron", true);
            chkSetCoopPlant = UiTheme.CreateCheckBox("Ekim Senkron", true);
            chkSetCoopChest = UiTheme.CreateCheckBox("Sandık Sırası (Mutex)", true);
            coopChecks.Children.Add(chkSetCoopEnabled);
            coopChecks.Children.Add(chkSetCoopBuilder);
            coopChecks.Children.Add(chkSetCoopTill);
            coopChecks.Children.Add(chkSetCoopPlant);
            coopChecks.Children.Add(chkSetCoopChest);
            sp7.Children.Add(coopChecks);
            c7.Child = sp7;
            sp.Children.Add(c7);

            // Category 8 (Hidden from end users, initialized as internal state)
            lblSetUpdateCurBuild = new TextBlock();
            lblSetUpdateStatus = new TextBlock();
            txtSetRepoOwner = new TextBox { Text = "mrzaknafein" };
            txtSetRepoName = new TextBox { Text = "SCT-AFK-Service" };
            txtSetRepoBranch = new TextBox { Text = "main" };
            chkSetUpdateAutoApply = new CheckBox { IsChecked = false };

            // Category 8: Yedekleme, Geri Yükleme & Ağ Temizliği
            Border c9 = UiTheme.CreateCard(new Thickness(16), new Thickness(0));
            StackPanel sp9 = new StackPanel();
            sp9.Children.Add(UiTheme.CreateText("8. 💾 YEDEKLEME, GERİ YÜKLEME & AĞ TEMİZLİĞİ", 13, FontWeights.ExtraBold, UiTheme.ForestGreen, new Thickness(0, 0, 0, 8)));
            WrapPanel backupBtns = new WrapPanel();
            backupBtns.Children.Add(UiTheme.CreateButton("📥 Ayarları Dışa Aktar (JSON)", "outline", OnExportConfigClick));
            backupBtns.Children.Add(UiTheme.CreateButton("📤 Ayarları İçe Aktar (JSON)", "outline", OnImportConfigClick));
            backupBtns.Children.Add(UiTheme.CreateButton("🗑️ Tüm Proxyleri Temizle", "danger", OnClearAllProxiesFromSettingsClick));
            sp9.Children.Add(backupBtns);
            c9.Child = sp9;
            sp.Children.Add(c9);

            sv.Content = sp;
            dock.Children.Add(sv);
            return dock;
        }

        // =====================================================================
        // STATE MANAGEMENT, EVENT HANDLERS & UI SYNCHRONIZATION
        // =====================================================================
        private static int ParseIntSafe(string s, int def)
        {
            if (string.IsNullOrEmpty(s)) return def;
            int v;
            return int.TryParse(s.Trim(), out v) ? v : def;
        }

        private bool IsProUser()
        {
            Dictionary<string, object> ka = JsonHelper.SubDict(appState, "keyauth");
            return JsonHelper.Str(ka, "plan", "").ToLowerInvariant() == "pro" || JsonHelper.Bool(ka, "isPro", false);
        }

        private Dictionary<string, object> GetSelectedAccount()
        {
            if (string.IsNullOrEmpty(selectedAccountId)) return new Dictionary<string, object>();
            List<object> accounts = JsonHelper.Arr(JsonHelper.SubDict(appState, "config"), "accounts");
            for (int i = 0; i < accounts.Count; i++)
            {
                Dictionary<string, object> acc = JsonHelper.Dict(accounts[i]);
                if (JsonHelper.Str(acc, "id", "") == selectedAccountId) return acc;
            }
            return new Dictionary<string, object>();
        }

        private Dictionary<string, object> GetSelectedBot()
        {
            if (string.IsNullOrEmpty(selectedAccountId)) return new Dictionary<string, object>();
            Dictionary<string, object> bots = JsonHelper.SubDict(appState, "bots");
            return JsonHelper.SubDict(bots, selectedAccountId);
        }

        private bool isHotUpdateRestarting = false;
        private bool initialSettingsPopulated = false;

        private void PreloadLocalDiskState()
        {
            try
            {
                string cfgPath = System.IO.Path.Combine(runtimeDir, "config.json");
                if (File.Exists(cfgPath))
                {
                    string rawCfg = File.ReadAllText(cfgPath, Encoding.UTF8);
                    Dictionary<string, object> cfgDict = JsonHelper.DeserializeDict(rawCfg);
                    if (cfgDict != null && cfgDict.Count > 0)
                    {
                        List<object> servers = JsonHelper.Arr(cfgDict, "servers");
                        Dictionary<string, object> srv = JsonHelper.SubDict(cfgDict, "server");
                        if (servers.Count == 0 && srv.Count > 0)
                        {
                            Dictionary<string, object> defSrv = new Dictionary<string, object>();
                            defSrv["id"] = "srv_1";
                            defSrv["name"] = JsonHelper.Str(srv, "host", "Ana Sunucu");
                            defSrv["host"] = JsonHelper.Str(srv, "host", "localhost");
                            defSrv["port"] = JsonHelper.Int(srv, "port", 25565);
                            defSrv["version"] = srv.ContainsKey("version") ? srv["version"] : false;
                            servers.Add(defSrv);
                            cfgDict["servers"] = servers;
                            cfgDict["selectedServerId"] = "srv_1";
                        }
                        appState["config"] = cfgDict;
                    }
                }
            }
            catch { }

            try
            {
                Dictionary<string, object> savedKa = ReadSavedKeyAuthFromDisk();
                if (savedKa != null && savedKa.Count > 0)
                {
                    appState["keyauth"] = savedKa;
                }
            }
            catch { }

            EnsureSelectedAccountValid();
            RenderAll(true);
            PopulateSettingsInputsFromState();
        }

        private Dictionary<string, object> ReadSavedKeyAuthFromDisk()
        {
            try
            {
                string kaPath = System.IO.Path.Combine(runtimeDir, "keyauth_saved.json");
                if (!File.Exists(kaPath)) return null;
                string rawKa = File.ReadAllText(kaPath, Encoding.UTF8);
                Dictionary<string, object> d = JsonHelper.DeserializeDict(rawKa);
                string uB64 = JsonHelper.Str(d, "u", "");
                string pB64 = JsonHelper.Str(d, "p", "");
                if (string.IsNullOrEmpty(uB64) || string.IsNullOrEmpty(pB64)) return null;

                string uname = Encoding.UTF8.GetString(Convert.FromBase64String(uB64));
                if (string.IsNullOrEmpty(uname)) return null;

                long exp = JsonHelper.Long(d, "exp", 0);
                long nowMs = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
                if (exp > 0 && nowMs >= exp) return null;

                string sub = JsonHelper.Str(d, "sub", "PRO (175.00 TL)");
                Dictionary<string, object> ka = new Dictionary<string, object>();
                ka["authenticated"] = true;
                ka["isPro"] = true;
                ka["plan"] = "pro";
                ka["planLabel"] = "PRO";
                ka["username"] = uname;
                ka["subscription"] = sub;
                ka["expiryTimestamp"] = exp;
                ka["hasSavedCredentials"] = true;
                return ka;
            }
            catch
            {
                return null;
            }
        }

        private void ApplyIncomingState(Dictionary<string, object> incoming, bool includeLogsAndSettings)
        {
            if (incoming == null || incoming.Count == 0) return;

            // Preserve local disk KeyAuth PRO session if keyauth_saved.json is still valid on disk
            Dictionary<string, object> inKa = JsonHelper.SubDict(incoming, "keyauth");
            if (!JsonHelper.Bool(inKa, "isPro", false))
            {
                Dictionary<string, object> diskKa = ReadSavedKeyAuthFromDisk();
                if (diskKa != null && diskKa.Count > 0)
                {
                    incoming["keyauth"] = diskKa;
                }
            }

            appState = incoming;

            List<object> rawLogs = JsonHelper.Arr(incoming, "logs");
            if (rawLogs.Count > 0 || includeLogsAndSettings)
            {
                logs.Clear();
                for (int i = 0; i < rawLogs.Count; i++)
                {
                    Dictionary<string, object> l = JsonHelper.Dict(rawLogs[i]);
                    if (l.Count > 0) logs.Add(l);
                }
            }

            EnsureSelectedAccountValid();
            RenderAll(includeLogsAndSettings || rawLogs.Count > 0);
            if (includeLogsAndSettings || !initialSettingsPopulated)
            {
                initialSettingsPopulated = true;
                PopulateSettingsInputsFromState();
            }
        }

        private void OnPipeConnectionChanged(bool connected)
        {
            if (connected)
            {
                isHotUpdateRestarting = false;
                if (overlayReconnect != null) overlayReconnect.Visibility = Visibility.Collapsed;
                LoadInitialState(false);
            }
            else if (isHotUpdateRestarting && overlayReconnect != null)
            {
                overlayReconnect.Visibility = Visibility.Visible;
            }
        }

        private void OnPipeServerEvent(string evName, Dictionary<string, object> evData)
        {
            if (evName == "state")
            {
                ApplyIncomingState(evData, false);
            }
            else if (evName == "log")
            {
                if (evData != null && evData.Count > 0)
                {
                    logs.Add(evData);
                    if (logs.Count > 250) logs.RemoveAt(0);
                    AppendSingleLogToConsole(evData);
                }
            }
            else if (evName == "sound")
            {
                string alertType = JsonHelper.Str(evData, "alertType", "damage");
                TriggerConfiguredSoundAlert(alertType);
            }
            else if (evName == "desktop-notification")
            {
                string title = JsonHelper.Str(evData, "title", "SCT AFK Bildirimi");
                string body = JsonHelper.Str(evData, "body", JsonHelper.Str(evData, "message", ""));
                if (!string.IsNullOrEmpty(body) && !JsonHelper.Bool(evData, "silent", false))
                {
                    ShowToast("📢 [" + title + "] " + body, "info");
                }
            }
            else if (evName == "admin-broadcast")
            {
                string title = JsonHelper.Str(evData, "title", "YÖNETİCİ BİLDİRİMİ");
                string message = JsonHelper.Str(evData, "message", "");
                TriggerConfiguredSoundAlert("mention");
                AdminBroadcastModal modal = new AdminBroadcastModal(this, title, message);
                modal.Show();
            }
            else if (evName == "hot-update-restarting" || evName == "server-restarting")
            {
                isHotUpdateRestarting = true;
                if (overlayReconnect != null)
                {
                    lblReconnectStatus.Text = "🚀 Güncelleme uygulandı, yeni motor başlatılıyor... Lütfen bekleyin.";
                    overlayReconnect.Visibility = Visibility.Visible;
                }
            }
        }

        private void TriggerConfiguredSoundAlert(string alertType)
        {
            Dictionary<string, object> cfg = JsonHelper.SubDict(appState, "config");
            Dictionary<string, object> snd = JsonHelper.SubDict(cfg, "soundAlerts");
            if (!JsonHelper.Bool(snd, "enabled", true)) return;
            if (alertType == "damage" && !JsonHelper.Bool(snd, "onDamage", true)) return;
            if (alertType == "disconnect" && !JsonHelper.Bool(snd, "onDisconnect", true)) return;
            if (alertType == "mention" && !JsonHelper.Bool(snd, "onMention", true)) return;
            if (alertType == "captcha" && !JsonHelper.Bool(snd, "onCaptcha", true)) return;
            if (alertType == "notify" && !JsonHelper.Bool(snd, "onNotify", true)) return;

            string theme = JsonHelper.Str(snd, "theme", "cyber");
            int vol = JsonHelper.Int(snd, "volume", 35);
            SctSoundSynthesizer.PlayAlertSound(alertType, theme, vol);
        }

        public void LoadInitialState(bool skipAutoLogin)
        {
            pipe.SendApiAsync("GET", "/api/state", null, delegate(int status, Dictionary<string, object> data)
            {
                if (status != 200 || data == null || data.Count == 0) return;

                ApplyIncomingState(data, true);

                Dictionary<string, object> ka = JsonHelper.SubDict(data, "keyauth");
                if (!skipAutoLogin && !JsonHelper.Bool(ka, "isPro", false) && JsonHelper.Bool(ka, "hasSavedCredentials", false))
                {
                    pipe.SendApiAsync("POST", "/api/keyauth/autologin", new Dictionary<string, object>(), delegate
                    {
                        LoadInitialState(true);
                    });
                }
            });
        }

        private void EnsureSelectedAccountValid()
        {
            List<object> accounts = JsonHelper.Arr(JsonHelper.SubDict(appState, "config"), "accounts");
            if (accounts.Count == 0)
            {
                selectedAccountId = null;
                return;
            }
            if (!string.IsNullOrEmpty(selectedAccountId))
            {
                for (int i = 0; i < accounts.Count; i++)
                {
                    if (JsonHelper.Str(accounts[i], "id", "") == selectedAccountId) return;
                }
            }
            selectedAccountId = JsonHelper.Str(accounts[0], "id", "");
        }

        private void RenderAll(bool includeFullLogs)
        {
            RenderTopBarAndKeyAuth();
            RenderSidebarLists();
            RenderInspectorHeader();
            RenderFarmAndActionsTab();
            if (activeTabIndex == 1) RenderInventoryAndContainer();
            if (activeTabIndex == 3 && IsProUser()) RenderBuilderTab();
            if (activeTabIndex == 4 && IsProUser()) RenderDefenseTab();
            if (includeFullLogs) RenderConsoleLogs();

            // Sync Pro Lock if active tab is Pro
            if (activeTabIndex == 3 || activeTabIndex == 4 || activeTabIndex == 5)
            {
                bool showLock = !IsProUser();
                proLockOverlay.Visibility = showLock ? Visibility.Visible : Visibility.Collapsed;
                tabPanes[activeTabIndex].Visibility = showLock ? Visibility.Collapsed : Visibility.Visible;
            }
        }

        private void RenderTopBarAndKeyAuth()
        {
            Dictionary<string, object> cfg = JsonHelper.SubDict(appState, "config");
            Dictionary<string, object> srv = JsonHelper.SubDict(cfg, "server");
            string host = JsonHelper.Str(srv, "host", "localhost");
            int port = JsonHelper.Int(srv, "port", 25565);
            string ver = JsonHelper.Str(srv, "version", "");
            if (string.IsNullOrEmpty(ver) || ver == "false") ver = "Otomatik";
            lblTopServerBadge.Text = string.Format("🌐 Sunucu: {0}:{1} ({2})", host, port, ver);

            List<object> accounts = JsonHelper.Arr(cfg, "accounts");
            Dictionary<string, object> bots = JsonHelper.SubDict(appState, "bots");
            int onlineCount = 0;
            for (int i = 0; i < accounts.Count; i++)
            {
                string aid = JsonHelper.Str(accounts[i], "id", "");
                Dictionary<string, object> b = JsonHelper.SubDict(bots, aid);
                if (JsonHelper.Str(b, "status", "") == "online") onlineCount++;
            }
            lblTopOnlineBadge.Text = string.Format("● {0} / {1} Bot Çevrimiçi", onlineCount, accounts.Count);

            // KeyAuth Card
            Dictionary<string, object> ka = JsonHelper.SubDict(appState, "keyauth");
            bool isPro = IsProUser();
            if (isPro)
            {
                badgeKaPlan.Background = UiTheme.ForestGreen;
                lblKaPlanText.Foreground = UiTheme.PureWhite;
                lblKaPlanText.Text = "💎 PRO PAKET";
                lblKaUser.Text = JsonHelper.Str(ka, "username", "PRO Üye");
                long expTs = JsonHelper.Long(ka, "expiryTimestamp", 0);
                lblKaExpiry.Text = "Süre: " + FormatRemainingExpiry(expTs);
                btnKaLogout.Visibility = Visibility.Visible;
            }
            else
            {
                badgeKaPlan.Background = UiTheme.SandBeige;
                lblKaPlanText.Foreground = UiTheme.ForestGreen;
                lblKaPlanText.Text = "STARTER";
                lblKaUser.Text = "Ücretsiz Sürüm (3 Bot)";
                lblKaExpiry.Text = "Süresiz";
                btnKaLogout.Visibility = Visibility.Collapsed;
            }

            // Hot-Update Banner
            Dictionary<string, object> updates = JsonHelper.SubDict(appState, "updates");
            if (JsonHelper.Bool(updates, "hasUpdate", false))
            {
                string latestBuild = JsonHelper.Str(updates, "latestBuildId", "");
                lblHotUpdateInfo.Text = "🚀 Yeni Güncelleme Mevcut! (" + latestBuild + ")";
                bannerHotUpdate.Visibility = Visibility.Visible;
            }
        }

        private static string FormatRemainingExpiry(long expiryMs)
        {
            if (expiryMs <= 0) return "Süresiz";
            long nowMs = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
            long diff = expiryMs - nowMs;
            if (diff <= 0) return "Süresi Doldu";
            TimeSpan ts = TimeSpan.FromMilliseconds(diff);
            if (ts.TotalDays >= 3650) return "Sınırsız";
            if (ts.TotalDays >= 1) return string.Format("{0}g {1}s", (int)ts.TotalDays, ts.Hours);
            return string.Format("{0}s {1}dk", ts.Hours, ts.Minutes);
        }

        private void RenderSidebarLists()
        {
            Dictionary<string, object> cfg = JsonHelper.SubDict(appState, "config");

            // 1. Servers List
            List<object> servers = JsonHelper.Arr(cfg, "servers");
            string selectedSrvId = JsonHelper.Str(cfg, "selectedServerId", "");
            lblServerCount.Text = "(" + servers.Count + ")";
            panelServerList.Children.Clear();

            for (int i = 0; i < servers.Count; i++)
            {
                Dictionary<string, object> s = JsonHelper.Dict(servers[i]);
                string sid = JsonHelper.Str(s, "id", "");
                string sname = JsonHelper.Str(s, "name", JsonHelper.Str(s, "host", "Sunucu"));
                string shost = JsonHelper.Str(s, "host", "localhost");
                int sport = JsonHelper.Int(s, "port", 25565);
                bool isSel = (sid == selectedSrvId);

                Border card = new Border
                {
                    Background = isSel ? UiTheme.BgCardHover : UiTheme.BgCard,
                    BorderBrush = isSel ? UiTheme.ForestGreen : UiTheme.BorderBrush,
                    BorderThickness = new Thickness(isSel ? 1.5 : 1),
                    CornerRadius = new CornerRadius(12),
                    Padding = new Thickness(11, 8, 11, 8),
                    Margin = new Thickness(0, 0, 0, 6),
                    Cursor = Cursors.Hand
                };
                string capturedSid = sid;
                Dictionary<string, object> capturedSrv = s;
                card.MouseLeftButtonDown += delegate
                {
                    pipe.SendApiAsync("POST", "/api/servers/" + capturedSid + "/select", new Dictionary<string, object>());
                };

                DockPanel dp = new DockPanel();
                StackPanel rightBtns = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
                Button btnEdit = UiTheme.CreateButton("✎", "outline", delegate(object sender, RoutedEventArgs e)
                {
                    e.Handled = true;
                    OpenServerDialog(capturedSrv);
                }, new Thickness(6, 2, 6, 2));
                Button btnDel = UiTheme.CreateButton("✕", "danger", delegate(object sender, RoutedEventArgs e)
                {
                    e.Handled = true;
                    DeleteServerById(capturedSid, sname);
                }, new Thickness(6, 2, 6, 2));
                rightBtns.Children.Add(btnEdit);
                rightBtns.Children.Add(btnDel);
                DockPanel.SetDock(rightBtns, Dock.Right);
                dp.Children.Add(rightBtns);

                StackPanel leftInfo = new StackPanel();
                leftInfo.Children.Add(UiTheme.CreateText((isSel ? "◉ " : "○ ") + sname, 12, FontWeights.Bold, isSel ? UiTheme.AccentWhite : UiTheme.TextMain));
                leftInfo.Children.Add(UiTheme.CreateText(shost + ":" + sport, 10.5, FontWeights.Normal, UiTheme.TextMuted));
                dp.Children.Add(leftInfo);

                card.Child = dp;
                panelServerList.Children.Add(card);
            }

            // 2. Accounts List
            List<object> accounts = JsonHelper.Arr(cfg, "accounts");
            Dictionary<string, object> bots = JsonHelper.SubDict(appState, "bots");
            lblAccountCount.Text = "(" + accounts.Count + ")";
            panelAccountList.Children.Clear();

            for (int i = 0; i < accounts.Count; i++)
            {
                Dictionary<string, object> acc = JsonHelper.Dict(accounts[i]);
                string aid = JsonHelper.Str(acc, "id", "");
                string uname = JsonHelper.Str(acc, "username", "Bot");
                Dictionary<string, object> b = JsonHelper.SubDict(bots, aid);
                string status = JsonHelper.Str(b, "status", "offline");
                bool isSel = (aid == selectedAccountId);
                bool isRunning = (status == "online" || status == "connecting" || status == "reconnecting");

                Brush dotBrush = UiTheme.TextDim;
                string statusLabel = "Çevrimdışı";
                if (status == "online") { dotBrush = UiTheme.Green; statusLabel = "Çevrimiçi"; }
                else if (status == "connecting") { dotBrush = UiTheme.Yellow; statusLabel = "Bağlanıyor"; }
                else if (status == "reconnecting") { dotBrush = UiTheme.Yellow; statusLabel = "Yeniden Bağlanıyor"; }

                Border card = new Border
                {
                    Background = isSel ? UiTheme.BgCardHover : UiTheme.BgCard,
                    BorderBrush = isSel ? UiTheme.ForestGreen : UiTheme.BorderBrush,
                    BorderThickness = new Thickness(isSel ? 1.5 : 1),
                    CornerRadius = new CornerRadius(12),
                    Padding = new Thickness(11, 8, 11, 8),
                    Margin = new Thickness(0, 0, 0, 6),
                    Cursor = Cursors.Hand
                };

                string capturedAid = aid;
                Dictionary<string, object> capturedAcc = acc;
                bool capturedRunning = isRunning;

                card.MouseLeftButtonDown += delegate
                {
                    selectedAccountId = capturedAid;
                    RenderAll(true);
                };

                DockPanel dp = new DockPanel();
                StackPanel rightBtns = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
                Button btnToggle = UiTheme.CreateButton(capturedRunning ? "⏹" : "▶", capturedRunning ? "danger" : "success", delegate(object sender, RoutedEventArgs e)
                {
                    e.Handled = true;
                    SendBotActionById(capturedAid, capturedRunning ? "stop" : "start", null);
                }, new Thickness(7, 3, 7, 3));
                Button btnEdit = UiTheme.CreateButton("✎", "outline", delegate(object sender, RoutedEventArgs e)
                {
                    e.Handled = true;
                    OpenAccountDialog(capturedAcc);
                }, new Thickness(6, 3, 6, 3));
                Button btnDel = UiTheme.CreateButton("✕", "danger", delegate(object sender, RoutedEventArgs e)
                {
                    e.Handled = true;
                    DeleteAccountById(capturedAid, uname);
                }, new Thickness(6, 3, 6, 3));
                rightBtns.Children.Add(btnToggle);
                rightBtns.Children.Add(btnEdit);
                rightBtns.Children.Add(btnDel);
                DockPanel.SetDock(rightBtns, Dock.Right);
                dp.Children.Add(rightBtns);

                StackPanel botRow = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
                botRow.Children.Add(McTextureHelper.CreateSkinAvatarBadge(uname, 30, dotBrush));

                StackPanel leftInfo = new StackPanel { Margin = new Thickness(9, 0, 0, 0) };
                leftInfo.Children.Add(UiTheme.CreateText(uname, 12.5, FontWeights.Bold, UiTheme.ForestGreen));

                string proxyStr = JsonHelper.Str(acc, "proxy", "");
                string subText = statusLabel + (string.IsNullOrEmpty(proxyStr) ? " • Yerel IP" : (" • Proxy: " + proxyStr));
                leftInfo.Children.Add(UiTheme.CreateText(subText, 10.5, FontWeights.Normal, UiTheme.TextMuted));
                botRow.Children.Add(leftInfo);
                dp.Children.Add(botRow);

                card.Child = dp;
                panelAccountList.Children.Add(card);
            }
        }

        private void RenderInspectorHeader()
        {
            Dictionary<string, object> acc = GetSelectedAccount();
            Dictionary<string, object> bot = GetSelectedBot();

            if (acc.Count == 0)
            {
                if (borderInspAvatar != null) borderInspAvatar.Child = CreateRoundLogo(44);
                lblInspUsername.Text = "Hesap Seçilmedi";
                lblInspSub.Text = "Sol menüden bir hesap seçin veya + Ekle ile yeni bot oluşturun";
                lblInspStatusText.Text = "● Çevrimdışı";
                lblInspStatusText.Foreground = UiTheme.TextMuted;
                lblInspHealthFood.Text = "❤ -/20  🍗 -/20";
                lblInspPos.Text = "📍 X:- Y:- Z:-";
                lblInspUptimePing.Text = "⏱ 00:00:00 • - ms";
                RenderScoreboardAndPlayers(null);
                return;
            }

            string inspUname = JsonHelper.Str(acc, "username", "Bot");
            if (borderInspAvatar != null) borderInspAvatar.Child = McTextureHelper.CreateSkinAvatar(inspUname, 44);
            lblInspUsername.Text = inspUname;
            string email = JsonHelper.Str(acc, "email", "Yok");
            string proxy = JsonHelper.Str(acc, "proxy", "");
            string brand = JsonHelper.Str(bot, "clientBrand", JsonHelper.Str(acc, "clientBrand", "vanilla"));
            lblInspSub.Text = string.Format("E-Posta: {0}  •  Proxy: {1}  •  Brand: {2}",
                string.IsNullOrEmpty(email) ? "Yok" : email,
                string.IsNullOrEmpty(proxy) ? "Kendi IP Adresin" : proxy,
                brand);

            string status = JsonHelper.Str(bot, "status", "offline");
            if (status == "online")
            {
                lblInspStatusText.Text = "● Çevrimiçi";
                lblInspStatusText.Foreground = UiTheme.Green;
                badgeInspStatus.BorderBrush = UiTheme.Green;
            }
            else if (status == "connecting" || status == "reconnecting")
            {
                lblInspStatusText.Text = "● Bağlanıyor";
                lblInspStatusText.Foreground = UiTheme.Yellow;
                badgeInspStatus.BorderBrush = UiTheme.Yellow;
            }
            else
            {
                lblInspStatusText.Text = "● Çevrimdışı";
                lblInspStatusText.Foreground = UiTheme.TextMuted;
                badgeInspStatus.BorderBrush = UiTheme.BorderBrush;
            }

            if (status == "online")
            {
                int hp = JsonHelper.Int(bot, "health", 20);
                int food = JsonHelper.Int(bot, "food", 20);
                lblInspHealthFood.Text = string.Format("❤ {0}/20  🍗 {1}/20", hp, food);
            }
            else
            {
                lblInspHealthFood.Text = "❤ -/20  🍗 -/20";
            }

            Dictionary<string, object> pos = JsonHelper.SubDict(bot, "position");
            if (pos.Count > 0)
            {
                lblInspPos.Text = string.Format("📍 {0}, {1}, {2}", JsonHelper.Int(pos, "x", 0), JsonHelper.Int(pos, "y", 64), JsonHelper.Int(pos, "z", 0));
            }
            else
            {
                lblInspPos.Text = "📍 X:- Y:- Z:-";
            }

            UpdateLiveCountersAndUptime();
            RenderScoreboardAndPlayers(bot);
        }

        private void UpdateLiveCountersAndUptime()
        {
            Dictionary<string, object> bot = GetSelectedBot();
            string status = JsonHelper.Str(bot, "status", "offline");
            Dictionary<string, object> st = JsonHelper.SubDict(bot, "stats");

            if (status == "online")
            {
                long connSince = JsonHelper.Long(st, "connectedSince", 0);
                long nowMs = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
                long elapsedMs = connSince > 0 ? Math.Max(0, nowMs - connSince) : 0;
                TimeSpan ts = TimeSpan.FromMilliseconds(elapsedMs);
                int ping = JsonHelper.Int(bot, "ping", 0);
                lblInspUptimePing.Text = string.Format("⏱ {0:00}:{1:00}:{2:00} • {3} ms", (int)ts.TotalHours, ts.Minutes, ts.Seconds, ping);
            }
            else
            {
                lblInspUptimePing.Text = "⏱ 00:00:00 • - ms";
            }

            if (lblFarmCounters != null)
            {
                lblFarmCounters.Text = string.Format(
                    "⛏️ Kazılan Blok: {0}  |  ⚔️ Kesilen Mob: {1}  |  🌾 Hasat: {2}  |  🌱 Çapalanan: {3}  |  🌿 Ekilen: {4}  |  💰 Çiftçi Satış: {5}  |  🛠️ Tamir: {6}  |  📦 Sandık: {7}  |  🛡️ Captcha: {8}",
                    JsonHelper.Int(st, "blocksMined", 0),
                    JsonHelper.Int(st, "mobsAttacked", 0),
                    JsonHelper.Int(st, "cropsHarvested", 0),
                    JsonHelper.Int(st, "blocksTilled", 0),
                    JsonHelper.Int(st, "cropsPlanted", 0),
                    JsonHelper.Int(st, "farmerSalesCount", 0),
                    JsonHelper.Int(st, "repairsCount", 0),
                    JsonHelper.Int(st, "chestsDeposited", 0),
                    JsonHelper.Int(st, "captchasSolved", 0));
            }
        }

        private void RenderScoreboardAndPlayers(Dictionary<string, object> bot)
        {
            panelSbLines.Children.Clear();
            panelOnlinePlayers.Children.Clear();

            if (bot == null || JsonHelper.Str(bot, "status", "offline") != "online")
            {
                lblSbTitle.Text = "📊 CANLI SCOREBOARD";
                lblSbMeta.Text = "";
                lblChatBalance.Text = "💰 Bakiye: -";
                panelSbLines.Children.Add(UiTheme.CreateText("Bot çevrimiçi değil.", 11.5, FontWeights.Normal, UiTheme.TextMuted));
                lblOnlinePlayersCount.Text = "👥 ÇEVRİMİÇİ OYUNCULAR (0)";
                return;
            }

            Dictionary<string, object> sb = JsonHelper.SubDict(bot, "scoreboard");
            string title = JsonHelper.CleanMinecraftCodes(JsonHelper.Str(sb, "title", "SCOREBOARD"));
            lblSbTitle.Text = "📊 " + (string.IsNullOrEmpty(title) ? "SCOREBOARD" : title);

            string money = JsonHelper.CleanMinecraftCodes(JsonHelper.Str(sb, "money", ""));
            string rank = JsonHelper.CleanMinecraftCodes(JsonHelper.Str(sb, "rank", ""));
            string island = JsonHelper.CleanMinecraftCodes(JsonHelper.Str(sb, "island", ""));
            lblChatBalance.Text = "💰 Bakiye: " + (string.IsNullOrEmpty(money) ? "-" : money);

            List<string> metaParts = new List<string>();
            if (!string.IsNullOrEmpty(money)) metaParts.Add("💰 " + money);
            if (!string.IsNullOrEmpty(rank)) metaParts.Add("🏅 " + rank);
            if (!string.IsNullOrEmpty(island)) metaParts.Add("🏝️ " + island);
            lblSbMeta.Text = string.Join("  •  ", metaParts.ToArray());

            List<object> lines = JsonHelper.Arr(sb, "lines");
            for (int i = 0; i < lines.Count; i++)
            {
                Dictionary<string, object> ln = JsonHelper.Dict(lines[i]);
                string raw = JsonHelper.Str(ln, "plain", JsonHelper.Str(ln, "text", ""));
                string cleaned = JsonHelper.CleanMinecraftCodes(raw);
                if (!string.IsNullOrEmpty(cleaned))
                {
                    panelSbLines.Children.Add(UiTheme.CreateText(cleaned, 11.5, FontWeights.SemiBold, UiTheme.TextMain, new Thickness(0, 1, 0, 1)));
                }
            }

            List<object> players = JsonHelper.Arr(bot, "players");
            lblOnlinePlayersCount.Text = "👥 ÇEVRİMİÇİ OYUNCULAR (" + players.Count + ")";
            int limit = Math.Min(players.Count, 80);
            for (int i = 0; i < limit; i++)
            {
                string pName = players[i] != null ? players[i].ToString() : "";
                if (!string.IsNullOrEmpty(pName))
                {
                    panelOnlinePlayers.Children.Add(UiTheme.CreateText("• " + pName, 11.5, FontWeights.Medium, UiTheme.TextMain, new Thickness(0, 1, 0, 1)));
                }
            }
        }

        private void RenderConsoleLogs()
        {
            if (panelLogLines == null) return;
            panelLogLines.Children.Clear();
            for (int i = 0; i < logs.Count; i++)
            {
                AppendSingleLogToConsole(logs[i], false);
            }
            if (scrollLogs != null) scrollLogs.ScrollToEnd();
        }

        private void AppendSingleLogToConsole(Dictionary<string, object> logItem, bool autoScroll = true)
        {
            if (panelLogLines == null || logItem == null) return;
            bool showAll = chkShowAllLogs == null || chkShowAllLogs.IsChecked == true;
            string logAccId = JsonHelper.Str(logItem, "accountId", "");
            if (!showAll && !string.IsNullOrEmpty(selectedAccountId) && logAccId != selectedAccountId) return;

            string time = JsonHelper.Str(logItem, "time", DateTime.Now.ToString("HH:mm:ss"));
            string user = JsonHelper.Str(logItem, "username", "Sistem");
            string tag = JsonHelper.Str(logItem, "tag", "BİLGİ");
            string text = JsonHelper.CleanMinecraftCodes(JsonHelper.Str(logItem, "text", JsonHelper.Str(logItem, "message", "")));

            Brush tagColor = UiTheme.TextMain;
            if (tag == "HATA" || tag == "ATILDI" || tag == "ÖLÜM" || tag == "UYARI") tagColor = UiTheme.Red;
            else if (tag == "BAĞLANTI" || tag == "SPAWN" || tag == "OTO-GİRİŞ") tagColor = UiTheme.Green;
            else if (tag.StartsWith("OTO-") || tag == "SPAWNER" || tag == "MINER-SANDIK") tagColor = UiTheme.Yellow;
            else if (tag == "CHAT" || tag == "SOHBET" || tag == "MESAJ") tagColor = UiTheme.BrushHex("#0284C7");

            TextBlock tb = new TextBlock
            {
                FontFamily = new FontFamily("Consolas"),
                FontSize = 12.5,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 1.5, 0, 1.5),
                Foreground = tagColor,
                Text = string.Format("[{0}] [{1}] [{2}] {3}", time, user, tag, text)
            };

            panelLogLines.Children.Add(tb);
            if (panelLogLines.Children.Count > 250)
            {
                panelLogLines.Children.RemoveAt(0);
            }
            if (autoScroll && scrollLogs != null) scrollLogs.ScrollToEnd();
        }

        private void RenderInventoryAndContainer()
        {
            if (gridOpenWinSlots == null || gridMainInv == null || gridHotbar == null) return;
            gridOpenWinSlots.Children.Clear();
            gridMainInv.Children.Clear();
            gridHotbar.Children.Clear();

            Dictionary<string, object> bot = GetSelectedBot();

            // 1. Open Container / Window
            Dictionary<string, object> openWin = JsonHelper.SubDict(bot, "openWindow");
            if (openWin.Count > 0)
            {
                string wTitle = JsonHelper.CleanMinecraftCodes(JsonHelper.Str(openWin, "title", "Menü"));
                List<object> wSlots = JsonHelper.Arr(openWin, "slots");
                lblOpenWinTitle.Text = "📦 Açık Menü: " + wTitle;
                lblOpenWinSlots.Text = "(" + wSlots.Count + " Slot)";

                for (int i = 0; i < wSlots.Count; i++)
                {
                    Dictionary<string, object> slotObj = JsonHelper.Dict(wSlots[i]);
                    gridOpenWinSlots.Children.Add(CreateSlotTile(slotObj, i, true, false));
                }
            }
            else
            {
                lblOpenWinTitle.Text = "📦 Açık Sunucu Menüsü / Sandık: Yok";
                lblOpenWinSlots.Text = "(0 Slot)";
            }

            // 2. Held Item
            Dictionary<string, object> held = JsonHelper.SubDict(bot, "heldItem");
            int activeHandSlot = JsonHelper.Int(held, "slot", -1);
            if (held.Count > 0)
            {
                string hRaw = JsonHelper.Str(held, "name", "");
                string hName = JsonHelper.CleanMinecraftCodes(JsonHelper.Str(held, "displayName", hRaw));
                int hCount = JsonHelper.Int(held, "count", 1);
                lblHeldItemBadge.Text = string.Format("✋ Eldeki: {0} (x{1})", hName, hCount);
                if (lblHeldItemName != null) lblHeldItemName.Text = string.Format("{0} (x{1})", hName, hCount);

                Dictionary<string, object> dura = JsonHelper.SubDict(held, "durability");
                if (dura.Count > 0 && lblHeldItemDurability != null)
                {
                    int curD = JsonHelper.Int(dura, "current", 0);
                    int maxD = JsonHelper.Int(dura, "max", 0);
                    int pct = JsonHelper.Int(dura, "percent", 100);
                    lblHeldItemDurability.Text = string.Format("Dayanıklılık: {0}/{1} (%{2})", curD, maxD, pct);
                }
                else if (lblHeldItemDurability != null)
                {
                    lblHeldItemDurability.Text = "Dayanıklılık: Sınırsız / N/A";
                }

                if (heldItemSlotBorder != null)
                {
                    heldItemSlotBorder.Child = McTextureHelper.CreateItemIcon(hRaw, 36);
                }
            }
            else
            {
                lblHeldItemBadge.Text = "✋ Eldeki: Boş El";
                if (lblHeldItemName != null) lblHeldItemName.Text = "Boş El (Eşya Kuşanılmadı)";
                if (lblHeldItemDurability != null) lblHeldItemDurability.Text = "Envanterdeki herhangi bir slota tıklayarak kuşanabilirsiniz.";
                if (heldItemSlotBorder != null) heldItemSlotBorder.Child = null;
            }

            // 3. Bot Inventory Mapping (Slot -> Item Dict)
            Dictionary<int, Dictionary<string, object>> slotMap = new Dictionary<int, Dictionary<string, object>>();
            List<object> invItems = JsonHelper.Arr(bot, "inventory");
            for (int i = 0; i < invItems.Count; i++)
            {
                Dictionary<string, object> it = JsonHelper.Dict(invItems[i]);
                int sNum = JsonHelper.Int(it, "slot", -1);
                if (sNum >= 0) slotMap[sNum] = it;
            }

            // Populate Main Inventory (Slots 9..35 = 27 Slots)
            for (int slotId = 9; slotId <= 35; slotId++)
            {
                Dictionary<string, object> it = slotMap.ContainsKey(slotId) ? slotMap[slotId] : null;
                bool isHeld = (slotId == activeHandSlot);
                gridMainInv.Children.Add(CreateSlotTile(it, slotId, false, isHeld));
            }

            // Populate Hotbar (Slots 36..44 = 9 Slots)
            for (int slotId = 36; slotId <= 44; slotId++)
            {
                Dictionary<string, object> it = slotMap.ContainsKey(slotId) ? slotMap[slotId] : null;
                bool isHeld = (slotId == activeHandSlot);
                gridHotbar.Children.Add(CreateSlotTile(it, slotId, false, isHeld));
            }
        }

        private UIElement CreateSlotTile(Dictionary<string, object> itemObj, int slotNum, bool isContainerSlot, bool isHeld)
        {
            bool hasItem = itemObj != null && itemObj.Count > 0;
            string rawName = hasItem ? JsonHelper.Str(itemObj, "name", "") : "";
            string dispName = hasItem ? JsonHelper.CleanMinecraftCodes(JsonHelper.Str(itemObj, "displayName", rawName)) : "";
            int count = hasItem ? JsonHelper.Int(itemObj, "count", 1) : 0;
            if (rawName == "air" || rawName == "hava" || count <= 0) hasItem = false;

            SolidColorBrush defaultBg = UiTheme.BrushHex("#282624");
            SolidColorBrush hoverBg = UiTheme.BrushHex("#383431");
            SolidColorBrush borderCol = isHeld ? UiTheme.BrushHex("#22C55E") : UiTheme.BrushHex("#3D3833");

            Border b = new Border
            {
                Width = 44,
                Height = 44,
                Background = defaultBg,
                BorderBrush = borderCol,
                BorderThickness = new Thickness(isHeld ? 2 : 1.5),
                CornerRadius = new CornerRadius(4),
                Margin = new Thickness(2),
                Cursor = hasItem ? Cursors.Hand : Cursors.Arrow
            };

            int capturedSlot = hasItem ? JsonHelper.Int(itemObj, "slot", slotNum) : slotNum;

            if (hasItem)
            {
                b.MouseEnter += delegate
                {
                    b.Background = hoverBg;
                    b.BorderBrush = UiTheme.BrushHex("#F59E0B");
                };
                b.MouseLeave += delegate
                {
                    b.Background = defaultBg;
                    b.BorderBrush = isHeld ? UiTheme.BrushHex("#22C55E") : UiTheme.BrushHex("#3D3833");
                };

                b.MouseLeftButtonDown += delegate(object s, MouseButtonEventArgs e)
                {
                    e.Handled = true;
                    if (isContainerSlot)
                        SendSelectedBotAction("clickWindowSlot", new Dictionary<string, object> { { "slot", capturedSlot }, { "button", 0 } });
                    else
                        SendSelectedBotAction("equipItem", new Dictionary<string, object> { { "slot", capturedSlot } });
                };
                b.MouseRightButtonDown += delegate(object s, MouseButtonEventArgs e)
                {
                    e.Handled = true;
                    if (isContainerSlot)
                        SendSelectedBotAction("clickWindowSlot", new Dictionary<string, object> { { "slot", capturedSlot }, { "button", 1 } });
                    else
                        SendSelectedBotAction("dropItem", new Dictionary<string, object> { { "slot", capturedSlot } });
                };

                // Tooltip
                StackPanel tt = new StackPanel { Margin = new Thickness(4) };
                tt.Children.Add(UiTheme.CreateText(dispName, 12, FontWeights.Bold, UiTheme.BrushHex("#55FF55")));
                tt.Children.Add(UiTheme.CreateText(string.Format("Adet: x{0}  •  Slot: #{1}", count, capturedSlot), 11, FontWeights.Normal, Brushes.White));
                if (!string.IsNullOrEmpty(rawName))
                {
                    tt.Children.Add(UiTheme.CreateText("minecraft:" + rawName, 9.5, FontWeights.Normal, UiTheme.BrushHex("#888888")));
                }

                Dictionary<string, object> dura = JsonHelper.SubDict(itemObj, "durability");
                if (dura.Count > 0)
                {
                    int curD = JsonHelper.Int(dura, "current", 0);
                    int maxD = JsonHelper.Int(dura, "max", 0);
                    int pct = JsonHelper.Int(dura, "percent", 100);
                    tt.Children.Add(UiTheme.CreateText(string.Format("Dayanıklılık: {0}/{1} (%{2})", curD, maxD, pct), 10.5, FontWeights.Bold, pct > 50 ? UiTheme.BrushHex("#55FF55") : (pct > 20 ? UiTheme.BrushHex("#FFAA00") : UiTheme.BrushHex("#FF5555"))));
                }

                tt.Children.Add(UiTheme.CreateText(isContainerSlot ? "Sol Tık: Al / Tıkla  |  Sağ Tık: Tekli Al" : "Sol Tık: Kuşan / Seç  |  Sağ Tık: Yere At", 10, FontWeights.Normal, UiTheme.BrushHex("#AAAAAA"), new Thickness(0, 3, 0, 0)));
                b.ToolTip = new ToolTip { Content = tt, Background = UiTheme.BrushHex("#181716"), BorderBrush = UiTheme.BrushHex("#555555") };
            }
            else
            {
                // Empty slot tooltip
                b.ToolTip = string.Format("Slot #{0} (Boş)", slotNum);
            }

            Grid grid = new Grid { Width = 40, Height = 40 };

            if (hasItem)
            {
                // Item Texture Image
                FrameworkElement icon = McTextureHelper.CreateItemIcon(rawName, 32);
                grid.Children.Add(icon);

                // Stack Count Badge
                if (count > 1)
                {
                    TextBlock cntTb = new TextBlock
                    {
                        Text = count.ToString(),
                        FontFamily = new FontFamily("Consolas"),
                        FontSize = 11.5,
                        FontWeight = FontWeights.Bold,
                        Foreground = Brushes.White,
                        HorizontalAlignment = HorizontalAlignment.Right,
                        VerticalAlignment = VerticalAlignment.Bottom,
                        Margin = new Thickness(0, 0, 1, 0),
                        Effect = new System.Windows.Media.Effects.DropShadowEffect
                        {
                            Color = Colors.Black,
                            BlurRadius = 1,
                            ShadowDepth = 1,
                            Direction = 315
                        }
                    };
                    grid.Children.Add(cntTb);
                }

                // Durability Bar
                Dictionary<string, object> dura = JsonHelper.SubDict(itemObj, "durability");
                if (dura.Count > 0)
                {
                    int pct = Math.Max(0, Math.Min(100, JsonHelper.Int(dura, "percent", 100)));
                    SolidColorBrush barBrush = pct > 50 ? UiTheme.BrushHex("#22C55E") : (pct > 20 ? UiTheme.BrushHex("#EAB308") : UiTheme.BrushHex("#EF4444"));

                    Border barBg = new Border
                    {
                        Width = 32,
                        Height = 2.5,
                        Background = UiTheme.BrushHex("#111827"),
                        HorizontalAlignment = HorizontalAlignment.Center,
                        VerticalAlignment = VerticalAlignment.Bottom,
                        Margin = new Thickness(0, 0, 0, 1)
                    };
                    Border barFill = new Border
                    {
                        Width = Math.Max(1.0, 32.0 * (pct / 100.0)),
                        Height = 2.5,
                        Background = barBrush,
                        HorizontalAlignment = HorizontalAlignment.Left
                    };
                    barBg.Child = barFill;
                    grid.Children.Add(barBg);
                }
            }
            else
            {
                // Faint slot number for empty slot
                TextBlock emptySlotNum = new TextBlock
                {
                    Text = slotNum.ToString(),
                    FontSize = 9.5,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = UiTheme.BrushHex("#3D3833"),
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center
                };
                grid.Children.Add(emptySlotNum);
            }

            b.Child = grid;
            return b;
        }

        private void RenderFarmAndActionsTab()
        {
            Dictionary<string, object> acc = GetSelectedAccount();
            Dictionary<string, object> bot = GetSelectedBot();

            UpdateModeToggleBtn("toggleAutoMine", JsonHelper.Bool(bot, "autoMine", false));
            UpdateModeToggleBtn("toggleAutoAttack", JsonHelper.Bool(bot, "autoAttack", false));
            UpdateModeToggleBtn("toggleAutoFarm", JsonHelper.Bool(bot, "autoFarm", false));
            UpdateModeToggleBtn("toggleAutoTill", JsonHelper.Bool(bot, "autoTill", false));
            UpdateModeToggleBtn("toggleAutoPlant", JsonHelper.Bool(bot, "autoPlant", false));
            UpdateModeToggleBtn("toggleAutoFarmerSell", JsonHelper.Bool(JsonHelper.SubDict(bot, "autoFarmerSell"), "enabled", false));
            UpdateModeToggleBtn("toggleAutoMinerChestSell", JsonHelper.Bool(JsonHelper.SubDict(bot, "autoMinerChestSell"), "enabled", false));

            bool spawnerRunning = JsonHelper.Bool(bot, "isSpawnerRoutineRunning", false) || JsonHelper.Bool(JsonHelper.SubDict(bot, "autoSpawnerRoutine"), "enabled", false);
            UpdateModeToggleBtn("toggleAutoSpawnerRoutine", spawnerRunning);
            if (btnSpawnerNow != null)
            {
                UiTheme.SetButtonVariant(btnSpawnerNow, spawnerRunning ? "⏹ Durdur" : "⚡ Şimdi Başlat", spawnerRunning ? "danger" : "outline");
            }

            bool jackEnabled = JsonHelper.Bool(JsonHelper.SubDict(bot, "autoJackOLantern"), "enabled", false);
            bool jackRunning = JsonHelper.Bool(bot, "isJackOLanternRunning", false);
            UpdateModeToggleBtn("toggleAutoJackOLantern", jackEnabled);
            if (btnJackNow != null)
            {
                UiTheme.SetButtonVariant(btnJackNow, jackRunning ? "⏹ Durdur" : "⚡ Şimdi Başlat", jackRunning ? "danger" : "outline");
            }

            UpdateModeToggleBtn("toggleAutoRightClick", JsonHelper.Bool(bot, "autoRightClick", false));
            UpdateModeToggleBtn("toggleAutoChest", JsonHelper.Bool(bot, "autoChest", false));
            UpdateModeToggleBtn("toggleSneak", JsonHelper.Bool(bot, "sneakLock", false));

            if (acc.Count > 0)
            {
                isUpdatingBotRuleChecks = true;
                SetRuleCheck("autoReconnect", JsonHelper.Bool(acc, "autoReconnect", true));
                SetRuleCheck("autoPickup", JsonHelper.Bool(acc, "autoPickup", true));
                SetRuleCheck("autoDepositChest", JsonHelper.Bool(acc, "autoDepositChest", true));
                SetRuleCheck("autoEquipTool", JsonHelper.Bool(acc, "autoEquipTool", JsonHelper.Bool(acc, "autoTool", true)));
                SetRuleCheck("autoToolRepair", JsonHelper.Bool(acc, "autoToolRepair", JsonHelper.Bool(acc, "autoRepair", true)));
                SetRuleCheck("autoCaptcha", JsonHelper.Bool(acc, "autoCaptcha", true));
                SetRuleCheck("prioritizeHarvestBeforePlant", JsonHelper.Bool(acc, "prioritizeHarvestBeforePlant", true));
                SetRuleCheck("farmerAutoSell", JsonHelper.Bool(acc, "farmerAutoSell", JsonHelper.Bool(acc, "autoSellEnabled", false)));
                isUpdatingBotRuleChecks = false;

                if (!txtAdvRepairCmd.IsFocused) txtAdvRepairCmd.Text = JsonHelper.Str(acc, "autoRepairCommand", "/tamir");
                if (!txtAdvRepairPct.IsFocused) txtAdvRepairPct.Text = JsonHelper.Int(acc, "autoRepairThreshold", 15).ToString();

                Dictionary<string, object> fCfg = JsonHelper.SubDict(bot, "autoFarmerSell");
                if (fCfg.Count == 0) fCfg = JsonHelper.SubDict(acc, "autoFarmerSell");
                if (!txtAdvFarmerSec.IsFocused) txtAdvFarmerSec.Text = JsonHelper.Int(fCfg, "intervalSec", 120).ToString();

                Dictionary<string, object> mCfg = JsonHelper.SubDict(bot, "autoMinerChestSell");
                if (mCfg.Count == 0) mCfg = JsonHelper.SubDict(acc, "autoMinerChestSell");
                if (!txtAdvMinerSec.IsFocused) txtAdvMinerSec.Text = JsonHelper.Int(mCfg, "intervalSec", 10).ToString();

                Dictionary<string, object> sCfg = JsonHelper.SubDict(bot, "autoSpawnerRoutine");
                if (sCfg.Count == 0) sCfg = JsonHelper.SubDict(acc, "autoSpawnerRoutine");
                if (!txtAdvSpawnerSec.IsFocused) txtAdvSpawnerSec.Text = JsonHelper.Int(sCfg, "intervalSec", 30).ToString();
                if (!txtAdvSpawnerCount.IsFocused) txtAdvSpawnerCount.Text = JsonHelper.Int(sCfg, "spawnerCount", 0).ToString();
                if (!txtAdvSpawnerCoords.IsFocused) txtAdvSpawnerCoords.Text = JsonHelper.Str(sCfg, "customCoords", "");

                Dictionary<string, object> jCfg = JsonHelper.SubDict(bot, "autoJackOLantern");
                if (jCfg.Count == 0) jCfg = JsonHelper.SubDict(acc, "autoJackOLantern");
                if (!txtJackInterval.IsFocused) txtJackInterval.Text = JsonHelper.Int(jCfg, "intervalSec", 20).ToString();
                if (!txtJackBatch.IsFocused) txtJackBatch.Text = JsonHelper.Int(jCfg, "batchSize", 32).ToString();
                if (!txtJackPumpkinChest.IsFocused) txtJackPumpkinChest.Text = JsonHelper.Str(jCfg, "pumpkinChest", "");
                if (!txtJackTorchChest.IsFocused) txtJackTorchChest.Text = JsonHelper.Str(jCfg, "torchChest", "");
                if (!txtJackOutputChest.IsFocused) txtJackOutputChest.Text = JsonHelper.Str(jCfg, "outputChest", "");
                if (!txtJackIronChest.IsFocused) txtJackIronChest.Text = JsonHelper.Str(jCfg, "ironChest", "");
                if (!txtJackStickChest.IsFocused) txtJackStickChest.Text = JsonHelper.Str(jCfg, "stickChest", "");
                if (!txtJackCarveSpot.IsFocused) txtJackCarveSpot.Text = JsonHelper.Str(jCfg, "carveSpot", "");
            }
        }

        private void UpdateModeToggleBtn(string key, bool isOn)
        {
            Button btn;
            if (autoModeToggleBtns.TryGetValue(key, out btn))
            {
                UiTheme.SetButtonVariant(btn, isOn ? "● Aktif (Açık)" : "Kapalı", isOn ? "success" : "outline");
            }
        }

        private void SetRuleCheck(string key, bool val)
        {
            CheckBox cb;
            if (botRuleChecks.TryGetValue(key, out cb)) cb.IsChecked = val;
        }

        private void RenderBuilderTab()
        {
            Dictionary<string, object> bot = GetSelectedBot();
            Dictionary<string, object> bld = JsonHelper.SubDict(bot, "builder");
            string sName = JsonHelper.Str(bld, "schematicName", "Yüklenmedi");
            int total = JsonHelper.Int(bld, "totalBlocks", 0);
            int placed = JsonHelper.Int(bld, "placedCount", 0);
            int w = JsonHelper.Int(bld, "width", 0);
            int h = JsonHelper.Int(bld, "height", 0);
            int l = JsonHelper.Int(bld, "length", 0);
            int pct = total > 0 ? Math.Min(100, (int)Math.Round((placed * 100.0) / total)) : 0;

            lblBuilderSchemInfo.Text = string.Format("Aktif Şema: {0} ({1}x{2}x{3} • {4} Blok)", sName, w, h, l, total);
            lblBuilderProgress.Text = string.Format("{0} / {1} Blok (%{2})", placed, total, pct);
            progBuilder.Value = pct;
            lblBuilderStatusMsg.Text = JsonHelper.Str(bld, "statusMessage", "Hazır.");

            Dictionary<string, object> orig = JsonHelper.SubDict(bld, "origin");
            if (orig.Count > 0)
            {
                if (!txtBuilderOx.IsFocused) txtBuilderOx.Text = JsonHelper.Int(orig, "x", 0).ToString();
                if (!txtBuilderOy.IsFocused) txtBuilderOy.Text = JsonHelper.Int(orig, "y", 64).ToString();
                if (!txtBuilderOz.IsFocused) txtBuilderOz.Text = JsonHelper.Int(orig, "z", 0).ToString();
            }

            Dictionary<string, object> corners = JsonHelper.SubDict(bld, "corners");
            if (corners.Count > 0)
            {
                Dictionary<string, object> p1 = JsonHelper.SubDict(corners, "pos1");
                Dictionary<string, object> p2 = JsonHelper.SubDict(corners, "pos2");
                if (p1.Count > 0)
                {
                    if (!txtBuilderP1x.IsFocused) txtBuilderP1x.Text = JsonHelper.Int(p1, "x", 0).ToString();
                    if (!txtBuilderP1y.IsFocused) txtBuilderP1y.Text = JsonHelper.Int(p1, "y", 64).ToString();
                    if (!txtBuilderP1z.IsFocused) txtBuilderP1z.Text = JsonHelper.Int(p1, "z", 0).ToString();
                }
                if (p2.Count > 0)
                {
                    if (!txtBuilderP2x.IsFocused) txtBuilderP2x.Text = JsonHelper.Int(p2, "x", 0).ToString();
                    if (!txtBuilderP2y.IsFocused) txtBuilderP2y.Text = JsonHelper.Int(p2, "y", 64).ToString();
                    if (!txtBuilderP2z.IsFocused) txtBuilderP2z.Text = JsonHelper.Int(p2, "z", 0).ToString();
                }
            }

            bool chainOn = JsonHelper.Bool(bld, "autoChainTillPlant", true);
            UiTheme.SetButtonVariant(btnBuilderChain, chainOn ? "🔄 İnşa➔Çapa➔Ekim Zinciri: AÇIK" : "🔄 İnşa➔Çapa➔Ekim Zinciri: KAPALI", chainOn ? "indigo" : "outline");

            bool coopOn = JsonHelper.Bool(JsonHelper.SubDict(JsonHelper.SubDict(appState, "config"), "multiBotCooperation"), "enabled", true);
            UiTheme.SetButtonVariant(btnBuilderCoop, coopOn ? "🤝 Çoklu Bot Ortak Çalışma: AÇIK" : "👤 Çoklu Bot Ortak Çalışma: KAPALI", coopOn ? "success" : "outline");

            // Saved Presets Dropdown
            List<object> presets = JsonHelper.Arr(JsonHelper.SubDict(appState, "config"), "builderPresets");
            if (presets.Count != builderPresetIds.Count)
            {
                builderPresetIds.Clear();
                cmbBuilderSavedPresets.Items.Clear();
                cmbBuilderSavedPresets.Items.Add("-- Kayıtlı Konum Seçin (" + presets.Count + ") --");
                for (int i = 0; i < presets.Count; i++)
                {
                    Dictionary<string, object> pr = JsonHelper.Dict(presets[i]);
                    builderPresetIds.Add(JsonHelper.Str(pr, "id", ""));
                    cmbBuilderSavedPresets.Items.Add(JsonHelper.Str(pr, "name", "Konum"));
                }
                cmbBuilderSavedPresets.SelectedIndex = 0;
            }

            // BOM Materials
            panelBuilderBom.Children.Clear();
            Dictionary<string, object> mats = JsonHelper.SubDict(bld, "materials");
            Dictionary<string, object> placedMats = JsonHelper.SubDict(bld, "placedMaterials");
            Dictionary<string, object> invCounts = JsonHelper.SubDict(bld, "inventoryCounts");
            if (mats.Count == 0)
            {
                panelBuilderBom.Children.Add(UiTheme.CreateText("Şema yüklendiğinde gerekli blok listesi burada görünür.", 11.5, FontWeights.Normal, UiTheme.TextMuted));
            }
            else
            {
                foreach (KeyValuePair<string, object> kv in mats)
                {
                    int needed = JsonHelper.Int(mats, kv.Key, 0);
                    int pl = JsonHelper.Int(placedMats, kv.Key, 0);
                    int have = JsonHelper.Int(invCounts, kv.Key, 0);
                    Border row = UiTheme.CreateCard(new Thickness(8, 5, 8, 5), new Thickness(0, 0, 0, 4));
                    DockPanel dp = new DockPanel();
                    dp.Children.Add(UiTheme.CreateText(kv.Key, 12, FontWeights.Bold, UiTheme.AccentWhite));
                    TextBlock r = UiTheme.CreateText(string.Format("Koyulan: {0}/{1}  •  Envanter: {2}", pl, needed, have), 11.5, FontWeights.SemiBold, pl >= needed ? UiTheme.Green : UiTheme.Yellow);
                    r.HorizontalAlignment = HorizontalAlignment.Right;
                    dp.Children.Add(r);
                    row.Child = dp;
                    panelBuilderBom.Children.Add(row);
                }
            }
        }

        private void RenderDefenseTab()
        {
            Dictionary<string, object> acc = GetSelectedAccount();
            Dictionary<string, object> bot = GetSelectedBot();
            if (acc.Count == 0) return;

            chkDefAutoEat.IsChecked = JsonHelper.Bool(acc, "autoEat", true);
            if (!txtDefFoodThreshold.IsFocused) txtDefFoodThreshold.Text = JsonHelper.Int(acc, "foodThreshold", 16).ToString();
            chkDefPanic.IsChecked = JsonHelper.Bool(acc, "panicDisconnect", false);
            if (!txtDefPanicHp.IsFocused) txtDefPanicHp.Text = JsonHelper.Int(acc, "panicHealth", 6).ToString();
            chkDefSafeRecovery.IsChecked = JsonHelper.Bool(acc, "safeRecovery", true);
            chkDefAutoCmd.IsChecked = JsonHelper.Bool(acc, "autoCommandEnabled", false);
            if (!txtDefAutoCmdText.IsFocused) txtDefAutoCmdText.Text = JsonHelper.Str(acc, "autoCommandText", "/sell all");
            if (!txtDefAutoCmdSec.IsFocused) txtDefAutoCmdSec.Text = JsonHelper.Int(acc, "autoCommandIntervalSec", 180).ToString();

            if (!txtDefJoinCmds.IsFocused)
            {
                List<object> jList = JsonHelper.Arr(acc, "customJoinCommands");
                List<string> jStrs = new List<string>();
                for (int i = 0; i < jList.Count; i++) if (jList[i] != null) jStrs.Add(jList[i].ToString());
                txtDefJoinCmds.Text = string.Join(Environment.NewLine, jStrs.ToArray());
            }

            if (!txtDefCustomBrand.IsFocused) txtDefCustomBrand.Text = JsonHelper.Str(acc, "customBrand", "");
            if (!txtDefViewDist.IsFocused) txtDefViewDist.Text = JsonHelper.Int(acc, "viewDistance", 10).ToString();
            txtDefHwid.Text = JsonHelper.Str(bot, "hwid", JsonHelper.Str(acc, "hwid", "HWID-XXXX-XXXX"));
        }

        private void PopulateSettingsInputsFromState()
        {
            Dictionary<string, object> cfg = JsonHelper.SubDict(appState, "config");
            if (cfg.Count == 0 || txtSetHost == null) return;

            Dictionary<string, object> srv = JsonHelper.SubDict(cfg, "server");
            txtSetHost.Text = JsonHelper.Str(srv, "host", "localhost");
            txtSetPort.Text = JsonHelper.Int(srv, "port", 25565).ToString();

            Dictionary<string, object> auth = JsonHelper.SubDict(cfg, "autoAuth");
            chkSetAuthEnabled.IsChecked = JsonHelper.Bool(auth, "enabled", true);
            chkSetAuthSmart.IsChecked = JsonHelper.Bool(auth, "smartDetect", true);
            txtSetAuthDelay.Text = JsonHelper.Int(auth, "delayMs", 1500).ToString();
            txtSetLoginCmd.Text = JsonHelper.Str(auth, "loginCommand", "/login {password}");
            txtSetRegCmd.Text = JsonHelper.Str(auth, "registerCommand", "/register {password} {email}");

            Dictionary<string, object> afk = JsonHelper.SubDict(cfg, "antiAfk");
            chkSetAfkEnabled.IsChecked = JsonHelper.Bool(afk, "enabled", true);
            txtSetAfkSec.Text = Math.Max(1, JsonHelper.Int(afk, "intervalMs", 15000) / 1000).ToString();

            Dictionary<string, object> rec = JsonHelper.SubDict(cfg, "reconnect");
            chkSetRecEnabled.IsChecked = JsonHelper.Bool(rec, "enabled", true);
            txtSetRecSec.Text = Math.Max(1, JsonHelper.Int(rec, "delayMs", 5000) / 1000).ToString();

            Dictionary<string, object> disc = JsonHelper.SubDict(cfg, "discord");
            chkSetWebhookEnabled.IsChecked = JsonHelper.Bool(disc, "enabled", false);
            txtSetWebhookUrl.Text = JsonHelper.Str(disc, "webhookUrl", "");
            chkSetWhDisconnect.IsChecked = JsonHelper.Bool(disc, "notifyDisconnect", true);
            chkSetWhPanic.IsChecked = JsonHelper.Bool(disc, "notifyPanic", true);
            chkSetWhDeath.IsChecked = JsonHelper.Bool(disc, "notifyDeath", true);
            chkSetWhCaptcha.IsChecked = JsonHelper.Bool(disc, "notifyCaptcha", true);

            Dictionary<string, object> snd = JsonHelper.SubDict(cfg, "soundAlerts");
            chkSetSoundEnabled.IsChecked = JsonHelper.Bool(snd, "enabled", true);
            sliderSetSoundVol.Value = JsonHelper.Int(snd, "volume", 35);
            chkSetSndDamage.IsChecked = JsonHelper.Bool(snd, "onDamage", true);
            chkSetSndDisconnect.IsChecked = JsonHelper.Bool(snd, "onDisconnect", true);
            chkSetSndMention.IsChecked = JsonHelper.Bool(snd, "onMention", true);
            chkSetSndCaptcha.IsChecked = JsonHelper.Bool(snd, "onCaptcha", true);
            chkSetSndNotify.IsChecked = JsonHelper.Bool(snd, "onNotify", true);

            Dictionary<string, object> dNotif = JsonHelper.SubDict(cfg, "desktopNotifications");
            chkSetDeskEnabled.IsChecked = JsonHelper.Bool(dNotif, "enabled", true);
            chkSetDeskMention.IsChecked = JsonHelper.Bool(dNotif, "onMention", true);
            chkSetDeskDisconnect.IsChecked = JsonHelper.Bool(dNotif, "onDisconnect", true);
            chkSetDeskDeath.IsChecked = JsonHelper.Bool(dNotif, "onDeath", true);
            chkSetDeskCaptcha.IsChecked = JsonHelper.Bool(dNotif, "onCaptcha", true);

            Dictionary<string, object> rpc = JsonHelper.SubDict(cfg, "discordRpc");
            chkSetRpcEnabled.IsChecked = JsonHelper.Bool(rpc, "enabled", true);
            chkSetRpcServer.IsChecked = JsonHelper.Bool(rpc, "showServer", true);
            chkSetRpcMode.IsChecked = JsonHelper.Bool(rpc, "showMode", true);
            chkSetRpcStats.IsChecked = JsonHelper.Bool(rpc, "showStats", true);
            chkSetRpcCrops.IsChecked = JsonHelper.Bool(rpc, "showCrops", true);
            chkSetRpcMobs.IsChecked = JsonHelper.Bool(rpc, "showMobs", true);
            chkSetRpcChests.IsChecked = JsonHelper.Bool(rpc, "showChests", true);
            chkSetRpcCaptchas.IsChecked = JsonHelper.Bool(rpc, "showCaptchas", false);
            chkSetRpcBuilder.IsChecked = JsonHelper.Bool(rpc, "showBuilder", true);
            chkSetRpcHealth.IsChecked = JsonHelper.Bool(rpc, "showHealth", false);
            chkSetRpcPing.IsChecked = JsonHelper.Bool(rpc, "showPing", false);
            chkSetRpcCoords.IsChecked = JsonHelper.Bool(rpc, "showCoords", false);
            chkSetRpcAccount.IsChecked = JsonHelper.Bool(rpc, "showAccount", false);
            chkSetRpcAvatar.IsChecked = JsonHelper.Bool(rpc, "showAvatar", true);
            chkSetRpcTime.IsChecked = JsonHelper.Bool(rpc, "showTime", true);
            txtSetRpcDetails.Text = JsonHelper.Str(rpc, "customDetails", "");
            txtSetRpcState.Text = JsonHelper.Str(rpc, "customState", "");
            txtSetRpcClientId.Text = JsonHelper.Str(rpc, "clientId", "450485984333660181");
            txtSetRpcImage.Text = JsonHelper.Str(rpc, "largeImageUrl", "");
            txtSetRpcBtn1Label.Text = JsonHelper.Str(rpc, "button1Label", "");
            txtSetRpcBtn1Url.Text = JsonHelper.Str(rpc, "button1Url", "");
            txtSetRpcBtn2Label.Text = JsonHelper.Str(rpc, "button2Label", "");
            txtSetRpcBtn2Url.Text = JsonHelper.Str(rpc, "button2Url", "");

            Dictionary<string, object> coop = JsonHelper.SubDict(cfg, "multiBotCooperation");
            chkSetCoopEnabled.IsChecked = JsonHelper.Bool(coop, "enabled", true);
            chkSetCoopBuilder.IsChecked = JsonHelper.Bool(coop, "builderSync", true);
            chkSetCoopTill.IsChecked = JsonHelper.Bool(coop, "tillSync", true);
            chkSetCoopPlant.IsChecked = JsonHelper.Bool(coop, "plantSync", true);
            chkSetCoopChest.IsChecked = JsonHelper.Bool(coop, "chestSync", true);
        }

        private void OnSaveAllGeneralSettingsClick(object sender, RoutedEventArgs e)
        {
            string verSel = cmbSetVersion.SelectedItem != null ? cmbSetVersion.SelectedItem.ToString() : "auto";
            object finalVer = false;
            if (verSel == "custom")
            {
                string cv = txtSetCustomVer.Text.Trim();
                if (!string.IsNullOrEmpty(cv)) finalVer = cv;
            }
            else if (verSel != "auto") finalVer = verSel;

            Dictionary<string, object> payload = new Dictionary<string, object>();
            payload["server"] = new Dictionary<string, object>
            {
                { "host", txtSetHost.Text.Trim() },
                { "port", ParseIntSafe(txtSetPort.Text, 25565) },
                { "version", finalVer }
            };
            payload["autoAuth"] = new Dictionary<string, object>
            {
                { "enabled", chkSetAuthEnabled.IsChecked == true },
                { "smartDetect", chkSetAuthSmart.IsChecked == true },
                { "delayMs", ParseIntSafe(txtSetAuthDelay.Text, 1500) },
                { "loginCommand", txtSetLoginCmd.Text.Trim() },
                { "registerCommand", txtSetRegCmd.Text.Trim() }
            };
            payload["antiAfk"] = new Dictionary<string, object>
            {
                { "enabled", chkSetAfkEnabled.IsChecked == true },
                { "intervalMs", Math.Max(1, ParseIntSafe(txtSetAfkSec.Text, 15)) * 1000 }
            };
            payload["reconnect"] = new Dictionary<string, object>
            {
                { "enabled", chkSetRecEnabled.IsChecked == true },
                { "delayMs", Math.Max(1, ParseIntSafe(txtSetRecSec.Text, 5)) * 1000 }
            };
            payload["discord"] = new Dictionary<string, object>
            {
                { "enabled", chkSetWebhookEnabled.IsChecked == true },
                { "webhookUrl", txtSetWebhookUrl.Text.Trim() },
                { "notifyDisconnect", chkSetWhDisconnect.IsChecked == true },
                { "notifyPanic", chkSetWhPanic.IsChecked == true },
                { "notifyDeath", chkSetWhDeath.IsChecked == true },
                { "notifyCaptcha", chkSetWhCaptcha.IsChecked == true }
            };
            payload["soundAlerts"] = new Dictionary<string, object>
            {
                { "enabled", chkSetSoundEnabled.IsChecked == true },
                { "theme", cmbSetSoundTheme.SelectedItem != null ? cmbSetSoundTheme.SelectedItem.ToString() : "cyber" },
                { "volume", (int)sliderSetSoundVol.Value },
                { "onDamage", chkSetSndDamage.IsChecked == true },
                { "onDisconnect", chkSetSndDisconnect.IsChecked == true },
                { "onMention", chkSetSndMention.IsChecked == true },
                { "onCaptcha", chkSetSndCaptcha.IsChecked == true },
                { "onNotify", chkSetSndNotify.IsChecked == true }
            };
            payload["desktopNotifications"] = new Dictionary<string, object>
            {
                { "enabled", chkSetDeskEnabled.IsChecked == true },
                { "onMention", chkSetDeskMention.IsChecked == true },
                { "onDisconnect", chkSetDeskDisconnect.IsChecked == true },
                { "onDeath", chkSetDeskDeath.IsChecked == true },
                { "onCaptcha", chkSetDeskCaptcha.IsChecked == true }
            };
            payload["multiBotCooperation"] = new Dictionary<string, object>
            {
                { "enabled", chkSetCoopEnabled.IsChecked == true },
                { "builderSync", chkSetCoopBuilder.IsChecked == true },
                { "tillSync", chkSetCoopTill.IsChecked == true },
                { "plantSync", chkSetCoopPlant.IsChecked == true },
                { "chestSync", chkSetCoopChest.IsChecked == true }
            };
            payload["discordRpc"] = new Dictionary<string, object>
            {
                { "enabled", chkSetRpcEnabled.IsChecked == true },
                { "clientId", txtSetRpcClientId.Text.Trim() },
                { "largeImageUrl", txtSetRpcImage.Text.Trim() },
                { "showServer", chkSetRpcServer.IsChecked == true },
                { "showMode", chkSetRpcMode.IsChecked == true },
                { "showStats", chkSetRpcStats.IsChecked == true },
                { "showBlocks", chkSetRpcStats.IsChecked == true },
                { "showCrops", chkSetRpcCrops.IsChecked == true },
                { "showMobs", chkSetRpcMobs.IsChecked == true },
                { "showChests", chkSetRpcChests.IsChecked == true },
                { "showCaptchas", chkSetRpcCaptchas.IsChecked == true },
                { "showBuilder", chkSetRpcBuilder.IsChecked == true },
                { "showHealth", chkSetRpcHealth.IsChecked == true },
                { "showPing", chkSetRpcPing.IsChecked == true },
                { "showCoords", chkSetRpcCoords.IsChecked == true },
                { "showAccount", chkSetRpcAccount.IsChecked == true },
                { "showAvatar", chkSetRpcAvatar.IsChecked == true },
                { "showTime", chkSetRpcTime.IsChecked == true },
                { "customDetails", txtSetRpcDetails.Text.Trim() },
                { "customState", txtSetRpcState.Text.Trim() },
                { "button1Label", txtSetRpcBtn1Label.Text.Trim() },
                { "button1Url", txtSetRpcBtn1Url.Text.Trim() },
                { "button2Label", txtSetRpcBtn2Label.Text.Trim() },
                { "button2Url", txtSetRpcBtn2Url.Text.Trim() }
            };

            pipe.SendApiAsync("POST", "/api/config", payload, delegate
            {
                ShowToast("✓ Tüm genel ayarlar başarıyla kaydedildi!", "success");
            });
        }

        private void OnTestWebhookClick(object sender, RoutedEventArgs e)
        {
            string url = txtSetWebhookUrl.Text.Trim();
            if (string.IsNullOrEmpty(url))
            {
                ShowToast("Lütfen önce Discord Webhook URL adresini girin.", "error");
                return;
            }
            pipe.SendApiAsync("POST", "/api/discord/test", new Dictionary<string, object> { { "webhookUrl", url } }, delegate(int st, Dictionary<string, object> d)
            {
                if (JsonHelper.Bool(d, "ok", false)) ShowToast("Test bildirimi Discord kanalınıza gönderildi!", "success");
                else ShowToast("Discord bildirimi gönderilemedi.", "error");
            });
        }

        private void OnCheckUpdateClick(object sender, RoutedEventArgs e)
        {
            ShowToast("GitHub üzerinden güncellemeler denetleniyor...", "info");
            pipe.SendApiAsync("POST", "/api/updates/check", new Dictionary<string, object>(), delegate(int st, Dictionary<string, object> data)
            {
                bool hasUp = JsonHelper.Bool(data, "hasUpdate", false);
                string latest = JsonHelper.Str(data, "latestBuildId", "");
                if (hasUp)
                {
                    lblHotUpdateInfo.Text = "🚀 Yeni Güncelleme Mevcut! (" + latest + ")";
                    bannerHotUpdate.Visibility = Visibility.Visible;
                    if (lblSetUpdateStatus != null) lblSetUpdateStatus.Text = "● Yeni Sürüm Bulundu: " + latest;
                    ShowToast("Yeni güncelleme mevcut: " + latest, "success");
                }
                else
                {
                    if (lblSetUpdateStatus != null) lblSetUpdateStatus.Text = "✓ Sisteminiz en güncel sürümde çalışıyor.";
                    ShowToast("Tebrikler, en son sürümü kullanıyorsunuz!", "success");
                }
            });
        }

        private void OnApplyUpdateClick(object sender, RoutedEventArgs e)
        {
            if (MessageBox.Show("Yeni sürüm indirilip motor yeniden başlatılacak. Devam edilsin mi?", "Güncellemeyi Yükle", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
                return;

            ShowToast("Güncelleme indiriliyor, lütfen bekleyin...", "info");
            pipe.SendApiAsync("POST", "/api/updates/apply", new Dictionary<string, object>(), delegate(int st, Dictionary<string, object> data)
            {
                string err = JsonHelper.Str(data, "error", "");
                if (!string.IsNullOrEmpty(err))
                {
                    ShowToast("Güncelleme hatası: " + err, "error");
                }
                else
                {
                    if (overlayReconnect != null)
                    {
                        lblReconnectStatus.Text = "🚀 Güncelleme tamamlandı, yeni motor başlatılıyor...";
                        overlayReconnect.Visibility = Visibility.Visible;
                    }
                }
            });
        }

        private void OnSaveUpdateRepoConfigClick(object sender, RoutedEventArgs e)
        {
            Dictionary<string, object> body = new Dictionary<string, object>
            {
                { "repoOwner", txtSetRepoOwner.Text.Trim() },
                { "repoName", txtSetRepoName.Text.Trim() },
                { "branch", txtSetRepoBranch.Text.Trim() },
                { "autoApply", chkSetUpdateAutoApply.IsChecked == true }
            };
            pipe.SendApiAsync("POST", "/api/updates/config", body, delegate
            {
                ShowToast("Hot-Update depo ayarları kaydedildi!", "success");
            });
        }

        private void OnExportConfigClick(object sender, RoutedEventArgs e)
        {
            WinForms.SaveFileDialog sfd = new WinForms.SaveFileDialog
            {
                Title = "Yapılandırma Yedeğini Kaydet",
                Filter = "JSON Yedek Dosyası (*.json)|*.json",
                FileName = "sct-afk-backup.json"
            };
            if (sfd.ShowDialog() != WinForms.DialogResult.OK) return;

            pipe.SendApiAsync("GET", "/api/config/export", null, delegate(int st, Dictionary<string, object> data)
            {
                if (st >= 400 || data == null || data.Count == 0)
                {
                    pipe.SendApiAsync("GET", "/api/backup", null, delegate(int st2, Dictionary<string, object> data2)
                    {
                        WriteBackupFile(sfd.FileName, data2 != null && data2.Count > 0 ? data2 : JsonHelper.SubDict(appState, "config"));
                    });
                }
                else
                {
                    WriteBackupFile(sfd.FileName, data);
                }
            });
        }

        private void WriteBackupFile(string path, Dictionary<string, object> data)
        {
            try
            {
                File.WriteAllText(path, JsonHelper.Serialize(data), Encoding.UTF8);
                ShowToast("Yedek dosyası dışa aktarıldı!", "success");
            }
            catch (Exception ex)
            {
                ShowToast("Dışa aktarma hatası: " + ex.Message, "error");
            }
        }

        private void OnImportConfigClick(object sender, RoutedEventArgs e)
        {
            WinForms.OpenFileDialog ofd = new WinForms.OpenFileDialog
            {
                Title = "Yedek Dosyası Seçin",
                Filter = "JSON Yedek Dosyası (*.json)|*.json|Tüm Dosyalar (*.*)|*.*"
            };
            if (ofd.ShowDialog() != WinForms.DialogResult.OK) return;

            try
            {
                string json = File.ReadAllText(ofd.FileName, Encoding.UTF8);
                Dictionary<string, object> parsed = JsonHelper.DeserializeDict(json);
                pipe.SendApiAsync("POST", "/api/config/import", parsed, delegate(int st, Dictionary<string, object> res)
                {
                    if (st >= 400 || JsonHelper.Str(res, "error", "") != "")
                    {
                        pipe.SendApiAsync("POST", "/api/restore", parsed, delegate
                        {
                            ShowToast("Yedek dosyası başarıyla geri yüklendi!", "success");
                            LoadInitialState(true);
                        });
                    }
                    else
                    {
                        ShowToast("Yedek dosyası başarıyla geri yüklendi!", "success");
                        LoadInitialState(true);
                    }
                });
            }
            catch (Exception ex)
            {
                ShowToast("Yedek okuma hatası: " + ex.Message, "error");
            }
        }

        private void OnClearAllProxiesFromSettingsClick(object sender, RoutedEventArgs e)
        {
            if (MessageBox.Show("Tüm hesaplardaki proxy adresleri temizlensin mi?", "Proxyleri Temizle", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
                return;

            Dictionary<string, object> body = new Dictionary<string, object> { { "action", "clearAll" } };
            pipe.SendApiAsync("POST", "/api/proxies/clear-all", body, delegate
            {
                pipe.SendApiAsync("POST", "/api/proxies/assign", body, delegate
                {
                    ShowToast("Tüm proxyler temizlendi.", "success");
                });
            });
        }

        // =====================================================================
        // DIALOG LAUNCHERS & BOT ACTIONS
        // =====================================================================
        private void OpenKeyAuthDialog(string initialMsg)
        {
            KeyAuthModal modal = new KeyAuthModal(this, pipe, initialMsg, delegate
            {
                ShowToast("PRO lisansınız doğrulandı!", "success");
                LoadInitialState(true);
            });
            modal.ShowDialog();
        }

        private void OnKeyAuthLogoutClick(object sender, RoutedEventArgs e)
        {
            if (MessageBox.Show("KeyAuth PRO oturumunuz kapatılsın mı?", "Oturumu Kapat", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
                return;
            pipe.SendApiAsync("POST", "/api/keyauth/logout", new Dictionary<string, object>(), delegate
            {
                ShowToast("PRO oturumu kapatıldı, Starter sürüme geçildi.", "info");
                LoadInitialState(true);
            });
        }

        private void OpenServerDialog(Dictionary<string, object> existingSrv)
        {
            ServerModal modal = new ServerModal(this, pipe, existingSrv, delegate
            {
                ShowToast("Sunucu kaydedildi.", "success");
            });
            modal.ShowDialog();
        }

        private void DeleteServerById(string id, string name)
        {
            if (MessageBox.Show("\"" + name + "\" sunucusunu silmek istediğinize emin misiniz?", "Sunucuyu Sil", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
                return;
            pipe.SendApiAsync("DELETE", "/api/servers/" + id, null, delegate
            {
                ShowToast("Sunucu silindi.", "info");
            });
        }

        private void OpenAccountDialog(Dictionary<string, object> existingAcc)
        {
            List<object> accounts = JsonHelper.Arr(JsonHelper.SubDict(appState, "config"), "accounts");
            if (existingAcc == null && !IsProUser() && accounts.Count >= 3)
            {
                OpenKeyAuthDialog("Starter sürümde en fazla 3 hesap ekleyebilirsiniz. Sınırsız hesap için PRO pakete geçin.");
                return;
            }
            AccountModal modal = new AccountModal(this, pipe, existingAcc, delegate(string savedId)
            {
                if (!string.IsNullOrEmpty(savedId)) selectedAccountId = savedId;
                ShowToast("Hesap kaydedildi.", "success");
            });
            modal.ShowDialog();
        }

        private void DeleteAccountById(string id, string username)
        {
            if (MessageBox.Show("\"" + username + "\" hesabını silmek istediğinize emin misiniz?", "Hesabı Sil", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
                return;
            pipe.SendApiAsync("DELETE", "/api/accounts/" + id, null, delegate
            {
                ShowToast("Hesap silindi.", "info");
            });
        }

        private void OnOpenProxyPoolClick(object sender, RoutedEventArgs e)
        {
            if (!IsProUser())
            {
                OpenKeyAuthDialog("Proxy Havuzu ve Çoklu IP dağıtımı PRO üyelere özeldir.");
                return;
            }
            List<object> accounts = JsonHelper.Arr(JsonHelper.SubDict(appState, "config"), "accounts");
            List<string> curProxies = new List<string>();
            for (int i = 0; i < accounts.Count; i++)
            {
                string p = JsonHelper.Str(accounts[i], "proxy", "");
                if (!string.IsNullOrEmpty(p)) curProxies.Add(p);
            }
            ProxyPoolModal modal = new ProxyPoolModal(this, pipe, curProxies, delegate
            {
                ShowToast("Proxy havuzu güncellendi.", "success");
            });
            modal.ShowDialog();
        }

        private void OnStartAllAccountsClick(object sender, RoutedEventArgs e)
        {
            pipe.SendApiAsync("POST", "/api/accounts/start-all", new Dictionary<string, object>(), delegate(int st, Dictionary<string, object> d)
            {
                if (st >= 400 || JsonHelper.Str(d, "error", "") != "")
                {
                    pipe.SendApiAsync("POST", "/api/accounts/bulk", new Dictionary<string, object> { { "action", "startAll" } });
                }
            });
        }

        private void OnStopAllAccountsClick(object sender, RoutedEventArgs e)
        {
            pipe.SendApiAsync("POST", "/api/accounts/stop-all", new Dictionary<string, object>(), delegate(int st, Dictionary<string, object> d)
            {
                if (st >= 400 || JsonHelper.Str(d, "error", "") != "")
                {
                    pipe.SendApiAsync("POST", "/api/accounts/bulk", new Dictionary<string, object> { { "action", "stopAll" } });
                }
            });
        }

        private void SendSelectedBotAction(string action, Dictionary<string, object> extra)
        {
            if (string.IsNullOrEmpty(selectedAccountId))
            {
                ShowToast("Lütfen önce sol menüden bir bot hesabı seçin.", "error");
                return;
            }
            SendBotActionById(selectedAccountId, action, extra);
        }

        private void SendBotActionById(string accountId, string action, Dictionary<string, object> extra)
        {
            Dictionary<string, object> body = new Dictionary<string, object>();
            body["action"] = action;
            if (extra != null)
            {
                foreach (KeyValuePair<string, object> kv in extra) body[kv.Key] = kv.Value;
            }
            pipe.SendApiAsync("POST", "/api/accounts/" + accountId + "/action", body, delegate(int st, Dictionary<string, object> res)
            {
                string err = JsonHelper.Str(res, "error", "");
                if (!string.IsNullOrEmpty(err))
                {
                    if (JsonHelper.Bool(res, "requiresPro", false))
                        OpenKeyAuthDialog(err);
                    else
                        ShowToast(err, "error");
                }
            });
        }
    }

    // =========================================================================
    // PROGRAM ENTRY POINT, RESOURCE EXTRACTION & SYSTEM TRAY CONTEXT
    // =========================================================================
    static class Program
    {
        public const string CURRENT_ENGINE_BUILD_ID = "20261107_mc_inventory_skin_v81";
        private const int MinNodeMajor = 18;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool DeleteFile(string name);

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern void SHChangeNotify(int wEventId, uint uFlags, string dwItem1, IntPtr dwItem2);

        [DllImport("shell32.dll", SetLastError = true)]
        private static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);

        private static void RemoveMarkOfTheWeb(string filePath)
        {
            try
            {
                if (File.Exists(filePath)) DeleteFile(filePath + ":Zone.Identifier");
            }
            catch { }
        }

        private static void RefreshExplorerIcon(string exePath)
        {
            try
            {
                if (!string.IsNullOrEmpty(exePath) && File.Exists(exePath))
                {
                    SHChangeNotify(0x00002000, 0x1005, exePath, IntPtr.Zero);
                }
                SHChangeNotify(0x08000000, 0x1000, IntPtr.Zero, IntPtr.Zero);
            }
            catch { }
        }

        private static void ExtractResource(string resourceName, string outputPath)
        {
            Assembly asm = Assembly.GetExecutingAssembly();
            byte[] embedded;
            using (Stream stream = asm.GetManifestResourceStream(resourceName))
            {
                if (stream == null) return;
                using (MemoryStream ms = new MemoryStream())
                {
                    stream.CopyTo(ms);
                    embedded = ms.ToArray();
                }
            }

            try
            {
                if (File.Exists(outputPath))
                {
                    string fileName = System.IO.Path.GetFileName(outputPath);
                    if (string.Equals(fileName, "index.js", StringComparison.OrdinalIgnoreCase))
                    {
                        string diskText = File.ReadAllText(outputPath, Encoding.UTF8);
                        Match m = Regex.Match(diskText, @"const\s+ENGINE_BUILD_ID\s*=\s*'([^']+)'");
                        string diskBuildId = m.Success ? m.Groups[1].Value : "";
                        bool hasPipeIpc = diskText.IndexOf("SctAfkEngineIpc", StringComparison.Ordinal) >= 0;
                        if (hasPipeIpc && !string.IsNullOrEmpty(diskBuildId) &&
                            (string.Equals(diskBuildId, CURRENT_ENGINE_BUILD_ID, StringComparison.OrdinalIgnoreCase) ||
                             IsBuildIdNewer(diskBuildId, CURRENT_ENGINE_BUILD_ID)))
                        {
                            return;
                        }
                    }
                    else if (string.Equals(fileName, "Launcher.cs", StringComparison.OrdinalIgnoreCase))
                    {
                        string diskText = File.ReadAllText(outputPath, Encoding.UTF8);
                        Match m = Regex.Match(diskText, @"CURRENT_ENGINE_BUILD_ID\s*=\s*""([^""]+)""");
                        string diskBuildId = m.Success ? m.Groups[1].Value : "";
                        bool hasWpfPipe = diskText.IndexOf("SctPipeClient", StringComparison.Ordinal) >= 0;
                        if (hasWpfPipe && !string.IsNullOrEmpty(diskBuildId) &&
                            (string.Equals(diskBuildId, CURRENT_ENGINE_BUILD_ID, StringComparison.OrdinalIgnoreCase) ||
                             IsBuildIdNewer(diskBuildId, CURRENT_ENGINE_BUILD_ID)))
                        {
                            return;
                        }
                    }
                    else
                    {
                        byte[] disk = File.ReadAllBytes(outputPath);
                        if (disk.Length == embedded.Length)
                        {
                            bool same = true;
                            for (int i = 0; i < disk.Length; i++)
                            {
                                if (disk[i] != embedded[i]) { same = false; break; }
                            }
                            if (same) return;
                        }
                    }
                }
            }
            catch { }

            string dir = System.IO.Path.GetDirectoryName(outputPath);
            if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
            string tmp = outputPath + ".tmp";
            File.WriteAllBytes(tmp, embedded);
            if (File.Exists(outputPath)) File.Delete(outputPath);
            File.Move(tmp, outputPath);
        }

        private static bool HasPopulatedUserConfig(string cfgPath)
        {
            try
            {
                if (!File.Exists(cfgPath)) return false;
                string raw = File.ReadAllText(cfgPath, Encoding.UTF8);
                Dictionary<string, object> d = JsonHelper.DeserializeDict(raw);
                if (JsonHelper.Arr(d, "accounts").Count > 0) return true;
                List<object> srvs = JsonHelper.Arr(d, "servers");
                for (int i = 0; i < srvs.Count; i++)
                {
                    string h = JsonHelper.Str(srvs[i], "host", "localhost");
                    if (!string.IsNullOrEmpty(h) && !string.Equals(h, "localhost", StringComparison.OrdinalIgnoreCase))
                        return true;
                }
            }
            catch { }
            return false;
        }

        private static void EnsureUserConfigAndAuthMigrated(string runtimeDir)
        {
            string targetCfg = System.IO.Path.Combine(runtimeDir, "config.json");
            string targetKa = System.IO.Path.Combine(runtimeDir, "keyauth_saved.json");

            string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string[] candidateDirs = new string[]
            {
                System.IO.Path.Combine(userProfile, ".gemini", "antigravity", "scratch", ".sct-afk-engine"),
                System.IO.Path.Combine(localAppData, "SCT_AFK_Service"),
                AppDomain.CurrentDomain.BaseDirectory
            };

            if (!HasPopulatedUserConfig(targetCfg))
            {
                foreach (string dir in candidateDirs)
                {
                    try
                    {
                        if (string.IsNullOrEmpty(dir)) continue;
                        string candCfg = System.IO.Path.Combine(dir, "config.json");
                        if (string.Equals(System.IO.Path.GetFullPath(candCfg), System.IO.Path.GetFullPath(targetCfg), StringComparison.OrdinalIgnoreCase))
                            continue;
                        if (HasPopulatedUserConfig(candCfg))
                        {
                            File.Copy(candCfg, targetCfg, true);
                            break;
                        }
                    }
                    catch { }
                }
            }

            if (!File.Exists(targetCfg))
            {
                ExtractResource("sct.config.json", targetCfg);
            }

            if (!File.Exists(targetKa))
            {
                foreach (string dir in candidateDirs)
                {
                    try
                    {
                        if (string.IsNullOrEmpty(dir)) continue;
                        string candKa = System.IO.Path.Combine(dir, "keyauth_saved.json");
                        if (string.Equals(System.IO.Path.GetFullPath(candKa), System.IO.Path.GetFullPath(targetKa), StringComparison.OrdinalIgnoreCase))
                            continue;
                        if (File.Exists(candKa))
                        {
                            File.Copy(candKa, targetKa, true);
                            break;
                        }
                    }
                    catch { }
                }
            }
        }

        private static void ExtractEmbeddedFiles(string runtimeDir)
        {
            string publicDir = System.IO.Path.Combine(runtimeDir, "public");
            if (!Directory.Exists(publicDir)) Directory.CreateDirectory(publicDir);

            EnsureUserConfigAndAuthMigrated(runtimeDir);
            ExtractResource("sct.package.json", System.IO.Path.Combine(runtimeDir, "package.json"));
            ExtractResource("sct.index.js", System.IO.Path.Combine(runtimeDir, "index.js"));
            ExtractResource("sct.logo.jpg", System.IO.Path.Combine(publicDir, "logo.jpg"));
            ExtractResource("sct.Launcher.cs", System.IO.Path.Combine(runtimeDir, "Launcher.cs"));
            ExtractResource("sct.app.ico", System.IO.Path.Combine(runtimeDir, "app.ico"));
        }

        public static string FindNodeExe()
        {
            string[] candidates = new string[]
            {
                System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "nodejs", "node.exe"),
                System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "node.exe"),
                @"C:\Program Files\nodejs\node.exe",
                @"C:\Program Files (x86)\nodejs\node.exe",
                System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
                System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs", "node.exe")
            };

            foreach (string c in candidates)
            {
                if (File.Exists(c)) return c;
            }

            string pathEnv = (Environment.GetEnvironmentVariable("PATH") ?? "") + ";" +
                             (Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.Machine) ?? "") + ";" +
                             (Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.User) ?? "");
            foreach (string p in pathEnv.Split(';'))
            {
                try
                {
                    string trimmed = Environment.ExpandEnvironmentVariables(p.Trim().Trim('"'));
                    if (string.IsNullOrEmpty(trimmed)) continue;
                    string full = System.IO.Path.Combine(trimmed, "node.exe");
                    if (File.Exists(full)) return full;
                }
                catch { }
            }
            return null;
        }

        private static int GetNodeMajorVersion(string nodeExe)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = nodeExe,
                    Arguments = "-v",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                using (Process p = Process.Start(psi))
                {
                    string output = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(8000);
                    Match m = Regex.Match(output ?? "", @"v(\d+)\.");
                    if (m.Success) return int.Parse(m.Groups[1].Value);
                }
            }
            catch { }
            return 0;
        }

        private class StatusSplash : WinForms.Form
        {
            private readonly WinForms.Label lbl;

            public StatusSplash(string text)
            {
                Text = "SCT AFK Service";
                Size = new Drawing.Size(480, 150);
                StartPosition = WinForms.FormStartPosition.CenterScreen;
                FormBorderStyle = WinForms.FormBorderStyle.FixedDialog;
                ControlBox = false;
                ShowInTaskbar = true;
                BackColor = Drawing.Color.FromArgb(15, 31, 22);
                ForeColor = Drawing.Color.FromArgb(232, 220, 196);
                TopMost = true;

                lbl = new WinForms.Label
                {
                    Text = text,
                    Dock = WinForms.DockStyle.Fill,
                    TextAlign = Drawing.ContentAlignment.MiddleCenter,
                    Font = new Drawing.Font("Segoe UI", 10, Drawing.FontStyle.Bold),
                    Padding = new WinForms.Padding(10)
                };
                Controls.Add(lbl);
            }

            public void SetStatus(string text)
            {
                try
                {
                    if (IsDisposed) return;
                    if (InvokeRequired)
                    {
                        BeginInvoke(new Action<string>(SetStatus), text);
                        return;
                    }
                    lbl.Text = text;
                }
                catch { }
            }
        }

        private static void RunWithSplash(string initialText, Action<Action<string>> work)
        {
            StatusSplash splash = new StatusSplash(initialText);
            Exception workError = null;

            Thread worker = new Thread(delegate()
            {
                try { work(splash.SetStatus); }
                catch (Exception ex) { workError = ex; }
                finally
                {
                    try { splash.BeginInvoke(new Action(splash.Close)); } catch { }
                }
            });
            worker.IsBackground = true;
            splash.Shown += delegate { worker.Start(); };

            WinForms.Application.Run(splash);
            if (workError != null) throw workError;
        }

        private static bool IsNodeUsable(string nodeExe)
        {
            if (string.IsNullOrEmpty(nodeExe)) return false;
            int major = GetNodeMajorVersion(nodeExe);
            return major == 0 || major >= MinNodeMajor;
        }

        private static bool InstallNodeJsAutomatic(Action<string> status)
        {
            try
            {
                status("Node.js LTS kuruluyor (winget)...\nBu işlem 1-3 dakika sürebilir, lütfen bekleyin.");
                ProcessStartInfo wingetPsi = new ProcessStartInfo
                {
                    FileName = "winget",
                    Arguments = "install OpenJS.NodeJS.LTS -e --silent --disable-interactivity --accept-source-agreements --accept-package-agreements",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                using (Process p = Process.Start(wingetPsi))
                {
                    if (p != null)
                    {
                        p.WaitForExit(240000);
                        if (IsNodeUsable(FindNodeExe())) return true;
                    }
                }
            }
            catch { }

            try { ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; } catch { }

            string arch = "x64";
            try
            {
                string pa = (Environment.GetEnvironmentVariable("PROCESSOR_ARCHITEW6432") ?? Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE") ?? "").ToUpperInvariant();
                if (pa == "ARM64") arch = "arm64";
                else if (!Environment.Is64BitOperatingSystem) arch = "x86";
            }
            catch { }

            string[] versions = new string[] { "v22.11.0", "v20.18.0" };
            string tempMsi = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "sct-node-lts-" + arch + ".msi");

            foreach (string ver in versions)
            {
                string url = "https://nodejs.org/dist/" + ver + "/node-" + ver + "-" + arch + ".msi";
                try
                {
                    status("Node.js " + ver + " indiriliyor (nodejs.org)...");
                    try { if (File.Exists(tempMsi)) File.Delete(tempMsi); } catch { }

                    using (WebClient wc = new WebClient())
                    {
                        ManualResetEvent done = new ManualResetEvent(false);
                        Exception dlError = null;
                        wc.DownloadProgressChanged += delegate(object s, DownloadProgressChangedEventArgs e)
                        {
                            status("Node.js " + ver + " indiriliyor... %" + e.ProgressPercentage);
                        };
                        wc.DownloadFileCompleted += delegate(object s, System.ComponentModel.AsyncCompletedEventArgs e)
                        {
                            if (e.Error != null) dlError = e.Error;
                            done.Set();
                        };
                        wc.DownloadFileAsync(new Uri(url), tempMsi);
                        if (!done.WaitOne(600000))
                        {
                            wc.CancelAsync();
                            continue;
                        }
                        if (dlError != null) continue;
                    }

                    if (!File.Exists(tempMsi) || new FileInfo(tempMsi).Length < 1000000) continue;

                    status("Node.js kuruluyor...\nWindows yönetici izni (UAC) isterse 'Evet' deyin.");
                    ProcessStartInfo msiPsi = new ProcessStartInfo
                    {
                        FileName = "msiexec.exe",
                        Arguments = string.Format("/i \"{0}\" /passive /norestart", tempMsi),
                        UseShellExecute = true
                    };
                    using (Process p = Process.Start(msiPsi))
                    {
                        if (p != null) p.WaitForExit(900000);
                    }
                    try { File.Delete(tempMsi); } catch { }
                    Thread.Sleep(1500);

                    if (IsNodeUsable(FindNodeExe())) return true;
                }
                catch { }
            }

            return IsNodeUsable(FindNodeExe());
        }

        private static string EnsureNodeInstalled()
        {
            string nodeExe = FindNodeExe();
            int nodeMajor = string.IsNullOrEmpty(nodeExe) ? 0 : GetNodeMajorVersion(nodeExe);
            bool tooOld = !string.IsNullOrEmpty(nodeExe) && nodeMajor > 0 && nodeMajor < MinNodeMajor;

            if (string.IsNullOrEmpty(nodeExe) || tooOld)
            {
                string question = tooOld
                    ? "Bilgisayarınızdaki Node.js sürümü (v" + nodeMajor + ") çok eski. SCT AFK Service için Node.js " + MinNodeMajor + " veya üzeri gereklidir.\n\nNode.js LTS otomatik olarak indirilip kurulsun mu?"
                    : "SCT AFK Service'in çalışabilmesi için Node.js gereklidir ve bilgisayarınızda bulunamadı.\n\nNode.js LTS otomatik olarak indirilip kurulsun mu? (Yaklaşık 30 MB)";

                WinForms.DialogResult dr = WinForms.MessageBox.Show(question, "SCT AFK Service - Node.js Gerekli", WinForms.MessageBoxButtons.YesNo, WinForms.MessageBoxIcon.Question);
                if (dr == WinForms.DialogResult.Yes)
                {
                    bool ok = false;
                    RunWithSplash("Node.js hazırlanıyor...", delegate(Action<string> status) { ok = InstallNodeJsAutomatic(status); });
                    nodeExe = FindNodeExe();
                    if (!ok && !IsNodeUsable(nodeExe)) nodeExe = null;
                }
                else if (tooOld)
                {
                    nodeExe = null;
                }
            }
            return IsNodeUsable(nodeExe) ? nodeExe : null;
        }

        private static string ComputeFileHash(string filePath)
        {
            try
            {
                using (MD5 md5 = MD5.Create())
                {
                    byte[] h = md5.ComputeHash(File.ReadAllBytes(filePath));
                    return BitConverter.ToString(h).Replace("-", "");
                }
            }
            catch { return ""; }
        }

        public static string BuildPathWithNode(string nodeExe)
        {
            string nodeDir = System.IO.Path.GetDirectoryName(nodeExe);
            string current = Environment.GetEnvironmentVariable("PATH") ?? "";
            return nodeDir + ";" + current;
        }

        private static string ReadLogTail(string logPath, int maxChars)
        {
            try
            {
                if (!File.Exists(logPath)) return "";
                string txt = File.ReadAllText(logPath);
                if (txt.Length > maxChars) txt = "..." + txt.Substring(txt.Length - maxChars);
                return txt.Trim();
            }
            catch { return ""; }
        }

        private static int RunNpmInstall(string npmCmd, string nodeExe, string runtimeDir, string logPath)
        {
            ProcessStartInfo npmPsi = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = "/d /c \"\"" + npmCmd + "\" install --no-audit --no-fund --loglevel=error > \"" + logPath + "\" 2>&1\"",
                WorkingDirectory = runtimeDir,
                CreateNoWindow = true,
                UseShellExecute = false,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            npmPsi.EnvironmentVariables["PATH"] = BuildPathWithNode(nodeExe);

            using (Process npmProc = Process.Start(npmPsi))
            {
                if (!npmProc.WaitForExit(900000))
                {
                    try { npmProc.Kill(); } catch { }
                    return -1;
                }
                return npmProc.ExitCode;
            }
        }

        private static bool EnsureDependenciesInstalled(string nodeExe, string runtimeDir)
        {
            string nodeModulesDir = System.IO.Path.Combine(runtimeDir, "node_modules");
            string marker = System.IO.Path.Combine(nodeModulesDir, ".sct_deps_ok");
            string pkgHash = ComputeFileHash(System.IO.Path.Combine(runtimeDir, "package.json"));

            bool depsOk = Directory.Exists(nodeModulesDir)
                && File.Exists(System.IO.Path.Combine(nodeModulesDir, "mineflayer", "package.json"))
                && File.Exists(marker);
            if (depsOk)
            {
                try { depsOk = File.ReadAllText(marker).Trim() == pkgHash; } catch { depsOk = false; }
            }
            if (depsOk) return true;

            string npmCmd = System.IO.Path.Combine(System.IO.Path.GetDirectoryName(nodeExe), "npm.cmd");
            if (!File.Exists(npmCmd))
            {
                WinForms.MessageBox.Show(
                    "Node.js kurulu fakat 'npm' bulunamadı.\nLütfen Node.js'i https://nodejs.org adresinden yeniden kurun.",
                    "SCT AFK Service", WinForms.MessageBoxButtons.OK, WinForms.MessageBoxIcon.Error);
                return false;
            }

            string logPath = System.IO.Path.Combine(runtimeDir, "npm_install.log");
            int exitCode = -1;

            RunWithSplash(
                "SCT AFK Service ilk kurulum bileşenleri hazırlanıyor...\nLütfen 30-90 saniye bekleyin, tamamlanınca otomatik açılacaktır.",
                delegate(Action<string> status)
                {
                    exitCode = RunNpmInstall(npmCmd, nodeExe, runtimeDir, logPath);
                    if (exitCode != 0)
                    {
                        status("Bileşen kurulumu tekrar deneniyor...");
                        Thread.Sleep(1500);
                        exitCode = RunNpmInstall(npmCmd, nodeExe, runtimeDir, logPath);
                    }
                });

            if (exitCode == 0 && File.Exists(System.IO.Path.Combine(nodeModulesDir, "mineflayer", "package.json")))
            {
                try { File.WriteAllText(marker, pkgHash); } catch { }
                return true;
            }

            string tail = ReadLogTail(logPath, 700);
            WinForms.MessageBox.Show(
                "Uygulama bileşenleri indirilemedi.\nLütfen internet bağlantınızı kontrol edip uygulamayı tekrar açın.\n\n" +
                (string.IsNullOrEmpty(tail) ? "" : "Ayrıntı:\n" + tail),
                "SCT AFK Service", WinForms.MessageBoxButtons.OK, WinForms.MessageBoxIcon.Error);
            return false;
        }

        public static string GetRuntimeDirectory()
        {
            string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            string agyScratch = System.IO.Path.Combine(userProfile, ".gemini", "antigravity", "scratch", ".sct-afk-engine");
            if (File.Exists(System.IO.Path.Combine(agyScratch, "SetupProgram.cs")) && File.Exists(System.IO.Path.Combine(agyScratch, "Launcher.cs")))
            {
                return agyScratch;
            }
            return System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SCT_AFK_Service");
        }

        public static int ExtractBuildVersionNumber(string buildId)
        {
            if (string.IsNullOrEmpty(buildId)) return 0;
            Match m = Regex.Match(buildId, @"_v(\d+)$", RegexOptions.IgnoreCase);
            if (m.Success)
            {
                int v;
                if (int.TryParse(m.Groups[1].Value, out v)) return v;
            }
            return 0;
        }

        public static bool IsBuildIdNewer(string candidate, string baseline)
        {
            if (string.IsNullOrEmpty(candidate)) return false;
            if (string.IsNullOrEmpty(baseline)) return true;
            if (string.Equals(candidate, baseline, StringComparison.OrdinalIgnoreCase)) return false;
            int candVer = ExtractBuildVersionNumber(candidate);
            int baseVer = ExtractBuildVersionNumber(baseline);
            if (candVer > 0 && baseVer > 0) return candVer > baseVer;
            return string.Compare(candidate, baseline, StringComparison.OrdinalIgnoreCase) > 0;
        }

        public static Process StartHiddenServer(string nodeExe, string runtimeDir)
        {
            string crashLog = System.IO.Path.Combine(runtimeDir, "crash.log");
            try { if (File.Exists(crashLog)) File.Delete(crashLog); } catch { }

            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = nodeExe,
                Arguments = "\"" + System.IO.Path.Combine(runtimeDir, "index.js") + "\"",
                WorkingDirectory = runtimeDir,
                CreateNoWindow = true,
                UseShellExecute = false,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            psi.EnvironmentVariables["PATH"] = BuildPathWithNode(nodeExe);
            psi.EnvironmentVariables["SCT_LAUNCHER_MANAGED"] = "1";

            Process server = Process.Start(psi);
            if (server != null)
            {
                try
                {
                    File.WriteAllText(System.IO.Path.Combine(runtimeDir, "server.pid"), server.Id.ToString(), Encoding.UTF8);
                }
                catch { }
            }
            return server;
        }

        public static void KillStaleInstances(string runtimeDir = null)
        {
            try
            {
                int currentPid = Process.GetCurrentProcess().Id;
                foreach (Process p in Process.GetProcesses())
                {
                    try
                    {
                        if (p.Id != currentPid && (p.ProcessName.IndexOf("SCT AFK Service", StringComparison.OrdinalIgnoreCase) >= 0 || p.ProcessName.IndexOf("SCT_AFK_Service", StringComparison.OrdinalIgnoreCase) >= 0))
                        {
                            p.Kill();
                        }
                    }
                    catch { }
                }

                if (string.IsNullOrEmpty(runtimeDir)) runtimeDir = GetRuntimeDirectory();

                string pidPath = System.IO.Path.Combine(runtimeDir, "server.pid");
                if (File.Exists(pidPath))
                {
                    try
                    {
                        string txt = File.ReadAllText(pidPath).Trim();
                        int pid;
                        if (int.TryParse(txt, out pid))
                        {
                            Process np = Process.GetProcessById(pid);
                            if (np != null && !np.HasExited) np.Kill();
                        }
                    }
                    catch { }
                    try { File.Delete(pidPath); } catch { }
                }
            }
            catch { }
        }

        [STAThread]
        static void Main()
        {
            try
            {
                RemoveMarkOfTheWeb(WinForms.Application.ExecutablePath);
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                if (!string.IsNullOrEmpty(baseDir) && Directory.Exists(baseDir))
                {
                    foreach (string f in Directory.GetFiles(baseDir)) RemoveMarkOfTheWeb(f);
                }
            }
            catch { }

            WinForms.Application.EnableVisualStyles();
            WinForms.Application.SetCompatibleTextRenderingDefault(false);

            bool createdNew;
            using (Mutex mutex = new Mutex(true, "Local\\SctAfkServiceLauncher", out createdNew))
            {
                string rDir = GetRuntimeDirectory();
                if (!createdNew)
                {
                    if (SctPipeClient.IsEnginePipeReady() && SctPipeClient.CheckEngineMatchingBuild(CURRENT_ENGINE_BUILD_ID))
                    {
                        return;
                    }
                    SctPipeClient.RequestPipeShutdown();
                    KillStaleInstances(rDir);
                    Thread.Sleep(600);
                }

                try
                {
                    RunLauncher();
                }
                catch (Exception ex)
                {
                    WinForms.MessageBox.Show(
                        "SCT AFK Service başlatılırken bir hata oluştu:\n" + ex.Message,
                        "SCT AFK Service",
                        WinForms.MessageBoxButtons.OK,
                        WinForms.MessageBoxIcon.Error
                    );
                }
            }
        }

        private static void RunLauncher()
        {
            string nodeExe = EnsureNodeInstalled();
            if (string.IsNullOrEmpty(nodeExe))
            {
                WinForms.MessageBox.Show(
                    "Node.js otomatik kurulamadı.\nLütfen https://nodejs.org adresinden 'LTS' sürümünü indirip kurun, ardından SCT AFK Service'i tekrar açın.",
                    "SCT AFK Service",
                    WinForms.MessageBoxButtons.OK,
                    WinForms.MessageBoxIcon.Warning
                );
                try { Process.Start("https://nodejs.org/en/download"); } catch { }
                return;
            }

            string runtimeDir = GetRuntimeDirectory();
            if (!Directory.Exists(runtimeDir))
            {
                DirectoryInfo di = Directory.CreateDirectory(runtimeDir);
                try { di.Attributes |= FileAttributes.Hidden; } catch { }
            }

            try
            {
                File.WriteAllText(System.IO.Path.Combine(runtimeDir, "exe_path.txt"), WinForms.Application.ExecutablePath, Encoding.UTF8);
                RefreshExplorerIcon(WinForms.Application.ExecutablePath);
            }
            catch { }

            bool engineAlreadyReady = SctPipeClient.IsEnginePipeReady() && SctPipeClient.CheckEngineMatchingBuild(CURRENT_ENGINE_BUILD_ID);
            if (!engineAlreadyReady)
            {
                if (SctPipeClient.IsEnginePipeReady())
                {
                    SctPipeClient.RequestPipeShutdown();
                }
                KillStaleInstances(runtimeDir);
                Thread.Sleep(400);
            }

            ExtractEmbeddedFiles(runtimeDir);

            if (!EnsureDependenciesInstalled(nodeExe, runtimeDir)) return;

            Process server = null;
            if (engineAlreadyReady && SctPipeClient.IsEnginePipeReady())
            {
                try
                {
                    string pidFile = System.IO.Path.Combine(runtimeDir, "server.pid");
                    if (File.Exists(pidFile))
                    {
                        int existingPid;
                        if (int.TryParse(File.ReadAllText(pidFile).Trim(), out existingPid))
                        {
                            server = Process.GetProcessById(existingPid);
                        }
                    }
                }
                catch { }
            }
            else
            {
                server = StartHiddenServer(nodeExe, runtimeDir);
                SctPipeClient.WaitForEnginePipeReady(18000);
            }

            WinForms.Application.Run(new SctTrayContext(runtimeDir, nodeExe, server));
        }

        // =====================================================================
        // SYSTEM TRAY CONTEXT & MENU RENDERER
        // =====================================================================
        public class DarkMenuColorTable : WinForms.ProfessionalColorTable
        {
            private Drawing.Color bgColor = Drawing.Color.FromArgb(15, 31, 22);
            private Drawing.Color hoverColor = Drawing.Color.FromArgb(39, 77, 54);
            private Drawing.Color borderColor = Drawing.Color.FromArgb(46, 87, 63);
            private Drawing.Color separatorColor = Drawing.Color.FromArgb(46, 87, 63);

            public override Drawing.Color MenuBorder { get { return borderColor; } }
            public override Drawing.Color MenuItemBorder { get { return borderColor; } }
            public override Drawing.Color ToolStripDropDownBackground { get { return bgColor; } }
            public override Drawing.Color ImageMarginGradientBegin { get { return bgColor; } }
            public override Drawing.Color ImageMarginGradientMiddle { get { return bgColor; } }
            public override Drawing.Color ImageMarginGradientEnd { get { return bgColor; } }
            public override Drawing.Color MenuItemSelected { get { return hoverColor; } }
            public override Drawing.Color MenuItemSelectedGradientBegin { get { return hoverColor; } }
            public override Drawing.Color MenuItemSelectedGradientEnd { get { return hoverColor; } }
            public override Drawing.Color MenuItemPressedGradientBegin { get { return hoverColor; } }
            public override Drawing.Color MenuItemPressedGradientMiddle { get { return hoverColor; } }
            public override Drawing.Color MenuItemPressedGradientEnd { get { return hoverColor; } }
            public override Drawing.Color SeparatorDark { get { return separatorColor; } }
            public override Drawing.Color SeparatorLight { get { return separatorColor; } }
        }

        public class SctTrayContext : WinForms.ApplicationContext
        {
            private readonly WinForms.NotifyIcon trayIcon;
            private Process serverProcess;
            private readonly string runtimeDirectory;
            private readonly string nodeExecutable;
            private readonly SctPipeClient pipeClient;
            private finalWindowHolder winHolder;
            private volatile bool isStopping = false;

            private class finalWindowHolder
            {
                public SctMainWindow Window;
            }

            public SctTrayContext(string runtimeDir, string nodeExe, Process server)
            {
                runtimeDirectory = runtimeDir;
                nodeExecutable = nodeExe;
                serverProcess = server;
                winHolder = new finalWindowHolder();

                WinForms.ContextMenuStrip menu = new WinForms.ContextMenuStrip();
                menu.ShowImageMargin = false;
                menu.ShowCheckMargin = false;
                menu.BackColor = Drawing.Color.FromArgb(15, 31, 22);
                menu.ForeColor = Drawing.Color.FromArgb(232, 220, 196);
                menu.Font = new Drawing.Font("Segoe UI", 9.5f, Drawing.FontStyle.Regular);
                menu.Renderer = new WinForms.ToolStripProfessionalRenderer(new DarkMenuColorTable());

                WinForms.ToolStripLabel titleItem = new WinForms.ToolStripLabel("SCT AFK Service (Native WPF)");
                titleItem.Font = new Drawing.Font("Segoe UI", 9.5f, Drawing.FontStyle.Bold);
                titleItem.ForeColor = Drawing.Color.FromArgb(232, 220, 196);
                menu.Items.Add(titleItem);
                menu.Items.Add(new WinForms.ToolStripSeparator());

                WinForms.ToolStripMenuItem openItem = new WinForms.ToolStripMenuItem("💻  Kontrol Panelini Aç", null, delegate { RestoreMainWindow(); });
                openItem.Font = new Drawing.Font("Segoe UI", 9.5f, Drawing.FontStyle.Bold);
                openItem.ForeColor = Drawing.Color.FromArgb(232, 220, 196);
                menu.Items.Add(openItem);

                WinForms.ToolStripMenuItem dirItem = new WinForms.ToolStripMenuItem("📁  Veri Klasörünü Aç", null, delegate { OpenDataFolder(); });
                dirItem.ForeColor = Drawing.Color.FromArgb(244, 239, 230);
                menu.Items.Add(dirItem);

                WinForms.ToolStripMenuItem restartItem = new WinForms.ToolStripMenuItem("🔄  Motoru Yeniden Başlat", null, delegate { RestartService(); });
                restartItem.ForeColor = Drawing.Color.FromArgb(244, 239, 230);
                menu.Items.Add(restartItem);

                menu.Items.Add(new WinForms.ToolStripSeparator());

                WinForms.ToolStripMenuItem exitItem = new WinForms.ToolStripMenuItem("❌  Çıkış (Botları Kapat)", null, delegate { ExitApplication(); });
                exitItem.ForeColor = Drawing.Color.FromArgb(239, 68, 68);
                menu.Items.Add(exitItem);

                string icoPath = System.IO.Path.Combine(runtimeDir, "app.ico");
                Drawing.Icon icon = null;
                try
                {
                    if (File.Exists(icoPath)) icon = new Drawing.Icon(icoPath);
                }
                catch { }
                if (icon == null) icon = Drawing.SystemIcons.Application;

                trayIcon = new WinForms.NotifyIcon
                {
                    Icon = icon,
                    ContextMenuStrip = menu,
                    Text = "SCT AFK Service",
                    Visible = true
                };
                trayIcon.DoubleClick += delegate { RestoreMainWindow(); };

                if (Application.Current == null)
                {
                    new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
                }

                pipeClient = new SctPipeClient(Dispatcher.CurrentDispatcher);
                pipeClient.OnServerEvent += delegate(string evName, Dictionary<string, object> evData)
                {
                    if (evName == "desktop-notification")
                    {
                        string title = JsonHelper.Str(evData, "title", "SCT AFK Service");
                        string body = JsonHelper.Str(evData, "body", JsonHelper.Str(evData, "message", ""));
                        if (!string.IsNullOrEmpty(body))
                        {
                            try { trayIcon.ShowBalloonTip(3500, title, body, WinForms.ToolTipIcon.Info); } catch { }
                        }
                    }
                };

                winHolder.Window = new SctMainWindow(
                    runtimeDirectory,
                    pipeClient,
                    delegate
                    {
                        try
                        {
                            trayIcon.ShowBalloonTip(3000, "SCT AFK Service", "SCT AFK Service arka planda çalışmaya devam ediyor.", WinForms.ToolTipIcon.Info);
                        }
                        catch { }
                    },
                    delegate
                    {
                        ExitApplication();
                    }
                );

                pipeClient.Start();
                winHolder.Window.Show();
                winHolder.Window.Activate();
            }

            private void RestoreMainWindow()
            {
                try
                {
                    if (!SctPipeClient.IsEnginePipeReady() && !string.IsNullOrEmpty(nodeExecutable))
                    {
                        serverProcess = StartHiddenServer(nodeExecutable, runtimeDirectory);
                    }
                    if (winHolder.Window != null)
                    {
                        if (!winHolder.Window.IsVisible) winHolder.Window.Show();
                        if (winHolder.Window.WindowState == WindowState.Minimized)
                            winHolder.Window.WindowState = WindowState.Normal;
                        winHolder.Window.Activate();
                    }
                }
                catch { }
            }

            private void OpenDataFolder()
            {
                try
                {
                    if (Directory.Exists(runtimeDirectory))
                    {
                        Process.Start("explorer.exe", "\"" + runtimeDirectory + "\"");
                    }
                }
                catch { }
            }

            private void RestartService()
            {
                try
                {
                    isStopping = true;
                    pipeClient.Stop();
                    SctPipeClient.RequestPipeShutdown();
                    try { if (serverProcess != null && !serverProcess.HasExited) serverProcess.Kill(); } catch { }
                    KillStaleInstances(runtimeDirectory);
                    trayIcon.Visible = false;
                    trayIcon.Dispose();
                    Process.Start(WinForms.Application.ExecutablePath);
                    ExitThread();
                }
                catch { }
            }

            private void ExitApplication()
            {
                if (isStopping) return;
                isStopping = true;
                try
                {
                    if (winHolder.Window != null)
                    {
                        winHolder.Window.PrepareForExit();
                        winHolder.Window.Close();
                    }
                }
                catch { }

                try
                {
                    pipeClient.Stop();
                    SctPipeClient.RequestPipeShutdown();
                    if (serverProcess != null && !serverProcess.HasExited)
                    {
                        serverProcess.Kill();
                    }
                    KillStaleInstances(runtimeDirectory);
                }
                catch { }

                try
                {
                    trayIcon.Visible = false;
                    trayIcon.Dispose();
                }
                catch { }

                try
                {
                    if (Application.Current != null) Application.Current.Shutdown();
                }
                catch { }

                ExitThread();
            }
        }
    }
}




