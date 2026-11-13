using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Runtime.InteropServices;

namespace PcCaptionBridge;

public enum TrayState
{
    /// <summary>Running, glasses not connected.</summary>
    Waiting,
    /// <summary>Glasses are reading captions.</summary>
    Connected,
    /// <summary>Live Captions is closed.</summary>
    NoLiveCaptions,
    Paused,
}

/// <summary>Draws the tray icon: a "CC" badge with a status dot.</summary>
public static class TrayIcons
{
    static readonly Dictionary<(TrayState, int), Icon> Cache = new();

    public static Icon For(TrayState state, int size)
    {
        if (Cache.TryGetValue((state, size), out var icon)) return icon;
        using var bmp = Draw(state, size);
        var hIcon = bmp.GetHicon();
        icon = (Icon)Icon.FromHandle(hIcon).Clone();
        DestroyIcon(hIcon);
        Cache[(state, size)] = icon;
        return icon;
    }

    public static Bitmap Draw(TrayState state, int size)
    {
        var bmp = new Bitmap(size, size);
        using var g = Graphics.FromImage(bmp);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        g.Clear(Color.Transparent);

        float s = size;
        var badge = state == TrayState.Paused ? Color.FromArgb(120, 120, 128) : Color.FromArgb(30, 41, 59);
        using (var path = RoundedRect(new RectangleF(s * 0.03f, s * 0.12f, s * 0.94f, s * 0.70f), s * 0.18f))
        using (var fill = new SolidBrush(badge))
            g.FillPath(fill, path);

        using (var font = new Font("Segoe UI", s * 0.40f, FontStyle.Bold, GraphicsUnit.Pixel))
        using (var white = new SolidBrush(Color.White))
        {
            var fmt = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
            g.DrawString("CC", font, white, new RectangleF(0, s * 0.11f, s, s * 0.72f), fmt);
        }

        Color? dot = state switch
        {
            TrayState.Connected => Color.FromArgb(34, 197, 94),
            TrayState.NoLiveCaptions => Color.FromArgb(245, 158, 11),
            _ => null,
        };
        if (dot is Color c)
        {
            float d = s * 0.46f;
            var r = new RectangleF(s - d, s - d, d, d);
            using var ring = new SolidBrush(Color.White);
            using var fill = new SolidBrush(c);
            g.FillEllipse(ring, r);
            r.Inflate(-s * 0.07f, -s * 0.07f);
            g.FillEllipse(fill, r);
        }
        else if (state == TrayState.Paused)
        {
            // Two pause bars in the corner.
            float d = s * 0.46f;
            var r = new RectangleF(s - d, s - d, d, d);
            using var ring = new SolidBrush(Color.White);
            using var bars = new SolidBrush(Color.FromArgb(60, 60, 66));
            g.FillEllipse(ring, r);
            float bw = d * 0.16f, bh = d * 0.46f, cy = r.Top + (d - bh) / 2;
            g.FillRectangle(bars, r.Left + d * 0.29f, cy, bw, bh);
            g.FillRectangle(bars, r.Left + d * 0.55f, cy, bw, bh);
        }
        return bmp;
    }

    static GraphicsPath RoundedRect(RectangleF r, float radius)
    {
        var p = new GraphicsPath();
        float d = radius * 2;
        p.AddArc(r.Left, r.Top, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Top, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.Left, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }

    [DllImport("user32.dll")]
    static extern bool DestroyIcon(IntPtr hIcon);
}
