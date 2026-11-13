using System.Text.RegularExpressions;

namespace PcCaptionBridge;

/// <summary>
/// Turns the rolling text block that Windows Live Captions shows into the
/// Media Bridge caption format: numbered finished lines plus the sentence that
/// is still being spoken (the "partial").
///
/// Live Captions keeps rewriting its last sentence and drops old text off the
/// front as it scrolls, so each read is compared with the lines we already
/// handed out. No Windows calls here, so it can be tested on its own.
/// </summary>
public sealed partial class CaptionTracker
{
    public sealed record Line(int Id, string Text, long T);

    /// <summary>How many finished lines to keep and serve.</summary>
    const int KeepLines = 30;

    /// <summary>How many recent lines a sentence in view may be matched against.</summary>
    const int MatchWindow = 8;

    /// <summary>A last sentence that ends in . ! or ? counts as finished after this long unchanged.</summary>
    public const long SettleMs = 1500;

    readonly List<Line> lines = new();
    int nextId = 1;
    string lastRaw = "";
    bool settledCommitted;

    public IReadOnlyList<Line> Lines => lines;
    public string Partial { get; private set; } = "";
    /// <summary>Goes up whenever <see cref="Lines"/> or <see cref="Partial"/> change.</summary>
    public int Seq { get; private set; }
    /// <summary>When the caption text last changed (ms), or 0 if it never has.</summary>
    public long LastChangeMs { get; private set; }

    /// <summary>Feed the full Live Captions text on every read, changed or not.</summary>
    public void Update(string? raw, long nowMs)
    {
        raw = Regex.Replace(raw ?? "", @"\s+", " ").Trim();
        if (raw == lastRaw)
        {
            SettleIfQuiet(nowMs);
            return;
        }
        lastRaw = raw;
        LastChangeMs = nowMs;
        settledCommitted = false;

        var sentences = SplitSentences(raw);
        var partial = sentences.Count > 0 ? sentences[^1] : "";
        var finished = sentences.Count > 0 ? sentences.GetRange(0, sentences.Count - 1) : new List<string>();

        bool changed = false;

        // Find the newest sentence in view that we already handed out. Everything
        // after it is new. Prefer a match with our newest line, the usual case.
        int matchAt = -1, matchedLine = -1;
        for (int k = 0; k < Math.Min(MatchWindow, lines.Count) && matchAt < 0; k++)
        {
            int li = lines.Count - 1 - k;
            for (int i = finished.Count - 1; i >= 0; i--)
            {
                if (Similar(finished[i], lines[li].Text))
                {
                    matchAt = i;
                    matchedLine = li;
                    break;
                }
            }
        }

        // The last settled sentence may still be on screen as the partial, with
        // nothing after it yet: don't show it twice.
        if (matchAt < 0 && lines.Count > 0 && finished.Count == 0 && Similar(partial, lines[^1].Text))
        {
            changed |= Revise(lines.Count - 1, partial);
            partial = "";
        }

        if (matchAt >= 0)
        {
            // Live Captions often fixes up a sentence right after it ends; keep
            // our copy in step while it is still one of the newest lines.
            if (matchedLine >= lines.Count - 3) changed |= Revise(matchedLine, finished[matchAt]);
        }

        for (int i = matchAt + 1; i < finished.Count; i++)
        {
            Add(finished[i], nowMs);
            changed = true;
        }

        if (partial != Partial)
        {
            Partial = partial;
            changed = true;
        }
        if (changed) Seq++;
    }

    /// <summary>A finished-looking last sentence that stops changing becomes a line.</summary>
    void SettleIfQuiet(long nowMs)
    {
        if (settledCommitted || Partial.Length == 0) return;
        if (nowMs - LastChangeMs < SettleMs) return;
        if (!EndsSentence(Partial)) return;
        if (lines.Count == 0 || !Similar(Partial, lines[^1].Text)) Add(Partial, nowMs);
        Partial = "";
        settledCommitted = true;
        Seq++;
    }

    void Add(string text, long nowMs)
    {
        lines.Add(new Line(nextId++, text, nowMs));
        if (lines.Count > KeepLines) lines.RemoveRange(0, lines.Count - KeepLines);
    }

    bool Revise(int index, string text)
    {
        var old = lines[index];
        // Text that scrolled off the front is shorter, not newer: keep ours.
        if (old.Text == text || Normalize(old.Text).EndsWith(Normalize(text))) return false;
        lines[index] = old with { Text = text };
        return true;
    }

    static bool EndsSentence(string s) => s.Length > 0 && ".!?".Contains(s[^1]);

    public static List<string> SplitSentences(string text)
    {
        var parts = new List<string>();
        foreach (var p in SentenceEnd().Split(text))
        {
            var t = p.Trim();
            if (t.Length > 0) parts.Add(t);
        }
        return parts;
    }

    static string Normalize(string s) =>
        Regex.Replace(Regex.Replace(s.ToLowerInvariant(), @"[^\p{L}\p{N}\s']", " "), @"\s+", " ").Trim();

    /// <summary>
    /// Same sentence, allowing for Live Captions' small rewrites and for the
    /// front being cut off as text scrolls away.
    /// </summary>
    public static bool Similar(string a, string b)
    {
        var na = Normalize(a);
        var nb = Normalize(b);
        if (na.Length == 0 || nb.Length == 0) return false;
        if (na == nb) return true;
        var shorter = na.Length <= nb.Length ? na : nb;
        var longer = na.Length <= nb.Length ? nb : na;
        // A cut-off or extended version of the same sentence.
        if (shorter.Length >= 12 && longer.Contains(shorter)) return true;

        var wa = na.Split(' ');
        var wb = nb.Split(' ');
        if (Math.Min(wa.Length, wb.Length) < 3) return false;
        var setA = new HashSet<string>(wa);
        var setB = new HashSet<string>(wb);
        int common = setA.Count(setB.Contains);
        return common / (double)Math.Max(setA.Count, setB.Count) >= 0.6;
    }

    [GeneratedRegex(@"(?<=[.!?])\s+")]
    private static partial Regex SentenceEnd();
}
