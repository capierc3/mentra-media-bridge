namespace PcCaptionBridge;

/// <summary>Checks for <see cref="CaptionTracker"/>. Run with: dotnet run -- --selftest</summary>
public static class SelfTest
{
    static int failures;

    static void Check(bool ok, string name)
    {
        Console.WriteLine($"{(ok ? "pass" : "FAIL")}  {name}");
        if (!ok) failures++;
    }

    static string Texts(CaptionTracker t) => string.Join(" | ", t.Lines.Select(l => l.Text));

    public static int Run()
    {
        {
            var t = new CaptionTracker();
            t.Update("Hello there", 0);
            Check(t.Lines.Count == 0 && t.Partial == "Hello there", "unfinished sentence is the partial");
            t.Update("Hello there. How are", 100);
            Check(Texts(t) == "Hello there." && t.Partial == "How are", "sentence ends, becomes a line");
            t.Update("Hello there. How are you doing today? I am", 200);
            Check(Texts(t) == "Hello there. | How are you doing today?" && t.Partial == "I am", "next sentence added once");
            t.Update("Hello there. How are you doing today? I am fine", 300);
            Check(t.Lines.Count == 2, "growing partial adds no lines");
        }
        {
            var t = new CaptionTracker();
            t.Update("The quick brown fox jumps. Over the lazy dog sleeping. And then", 0);
            var ids = t.Lines.Select(l => l.Id).ToArray();
            // Old text scrolls off the front, cutting the first sentence.
            t.Update("brown fox jumps. Over the lazy dog sleeping. And then it ran away. Far", 100);
            Check(Texts(t) == "The quick brown fox jumps. | Over the lazy dog sleeping. | And then it ran away.",
                "scrolled-off text is not added again");
            Check(t.Lines[0].Id == ids[0] && t.Lines[0].Text == "The quick brown fox jumps.", "cut-off line keeps its full text");
        }
        {
            var t = new CaptionTracker();
            t.Update("I went to the store yesterday. And", 0);
            t.Update("I went to the store yesterday afternoon. And bought", 100);
            Check(Texts(t) == "I went to the store yesterday afternoon." && t.Lines.Count == 1, "fixed-up newest line is revised, not duplicated");
        }
        {
            var t = new CaptionTracker();
            t.Update("That is all for today.", 0);
            t.Update("That is all for today.", 500);
            Check(t.Lines.Count == 0, "finished last sentence waits to settle");
            var seq = t.Seq;
            t.Update("That is all for today.", 500 + CaptionTracker.SettleMs);
            Check(Texts(t) == "That is all for today." && t.Partial == "" && t.Seq > seq, "quiet finished sentence settles into a line");
            t.Update("That is all for today. Thanks", 3000);
            Check(t.Lines.Count == 1 && t.Partial == "Thanks", "settled line isn't added twice");
        }
        {
            var t = new CaptionTracker();
            t.Update("One two three.", 0);
            t.Update("One two three.", 2000);
            t.Update("", 2100);
            Check(t.Lines.Count == 1 && t.Partial == "", "cleared window keeps old lines");
            t.Update("Brand new talk here", 2200);
            Check(t.Lines.Count == 1 && t.Partial == "Brand new talk here", "new text after clear is the partial");
        }
        {
            var t = new CaptionTracker();
            t.Update("abc", 0);
            var s = t.Seq;
            t.Update("abc", 100);
            Check(t.Seq == s, "no change, no seq bump");
        }
        Check(CaptionTracker.Similar("hello world how are you", "Hello, world. How are you?"), "similar ignores punctuation");
        Check(!CaptionTracker.Similar("Yes.", "No."), "short different sentences don't match");

        Console.WriteLine(failures == 0 ? "\nAll checks passed." : $"\n{failures} check(s) failed.");
        return failures == 0 ? 0 : 1;
    }
}
