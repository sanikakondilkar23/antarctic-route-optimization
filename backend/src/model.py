"""
model.py — ConvLSTM-based sea-ice concentration forecaster.

ConvLSTMCell is written from scratch (auditable).
No external ConvLSTM pip package used.
"""

import torch
import torch.nn as nn


class ConvLSTMCell(nn.Module):
    """Single ConvLSTM cell.

    Parameters
    ----------
    input_channels : int
        Number of channels in the input tensor.
    hidden_channels : int
        Number of channels in the hidden state.
    kernel_size : int
        Convolution kernel size (square).
    """

    def __init__(self, input_channels: int, hidden_channels: int, kernel_size: int = 3):
        super().__init__()
        self.hidden_channels = hidden_channels
        padding = kernel_size // 2

        # Combined convolution for input and hidden: produces 4 * hidden_channels
        # gates: input, forget, cell candidate, output
        self.conv = nn.Conv2d(
            input_channels + hidden_channels,
            4 * hidden_channels,
            kernel_size,
            padding=padding,
            bias=True,
        )

    def forward(self, x: torch.Tensor, h: torch.Tensor, c: torch.Tensor):
        """
        Parameters
        ----------
        x : [B, C_in, H, W]
        h : [B, C_hidden, H, W]   current hidden state
        c : [B, C_hidden, H, W]   current cell state

        Returns
        -------
        h_new, c_new : [B, C_hidden, H, W]
        """
        combined = torch.cat([x, h], dim=1)  # [B, C_in + C_hidden, H, W]
        gates = self.conv(combined)  # [B, 4*C_hidden, H, W]
        i, f, g, o = torch.chunk(gates, 4, dim=1)
        i = torch.sigmoid(i)  # input gate
        f = torch.sigmoid(f)  # forget gate
        g = torch.tanh(g)     # cell candidate
        o = torch.sigmoid(o)  # output gate

        c_new = f * c + i * g
        h_new = o * torch.tanh(c_new)
        return h_new, c_new


class ConvLSTMForecaster(nn.Module):
    """2-layer ConvLSTM encoder + 1×1 conv prediction head.

    Input:  [B, 5, 10, H, W]  (5 timesteps, 10 channels =
             channel 0 = SIC, channels 1-9 = forcing:
             u10, v10, t2m, uo, vo, thetao, so, zos, SIC_prev_year)
    Output: [B, 3, H, W]      (predicted SIC at days D+1..D+3,
             sigmoid-bounded)

    Capacity is deliberately fixed (brief 3e/3g): 2 layers, hidden
    (32, 64), kernel 3, padding 1, sigmoid head, no dropout/norm/skip.
    Dropout2d(p=0.1) before the head enables MC Dropout at inference
    for epistemic uncertainty quantification.
    """

    def __init__(
        self,
        in_channels: int = 10,
        hidden_channels=(32, 64),
        kernel_size: int = 3,
    ):
        super().__init__()
        self.hidden_channels = hidden_channels
        self.num_layers = len(hidden_channels)

        # Build ConvLSTM cells
        self.cells = nn.ModuleList()
        ch_in = in_channels
        for ch_h in hidden_channels:
            self.cells.append(ConvLSTMCell(ch_in, ch_h, kernel_size))
            ch_in = ch_h

        # Stochastic layer enabling MC Dropout at inference (p=0.1).
        # Reduced from 0.2 to avoid over-regularization on small dataset
        # (1,461 training days). Adds zero parameters.
        self.dropout = nn.Dropout2d(p=0.1)

        # Prediction head: 1×1 conv on top-layer hidden → 3 channels (D+1..D+3)
        self.head = nn.Conv2d(hidden_channels[-1], 3, kernel_size=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Parameters
        ----------
        x : [B, T, C, H, W]   T=5, C=10

        Returns
        -------
        pred : [B, 3, H, W]   SIC in [0, 1] for days D+1..D+3
        """
        B, T, C, H, W = x.shape

        # Initialize hidden and cell states for each layer
        h_states = []
        c_states = []
        for ch in self.hidden_channels:
            h_states.append(torch.zeros(B, ch, H, W, device=x.device, dtype=x.dtype))
            c_states.append(torch.zeros(B, ch, H, W, device=x.device, dtype=x.dtype))

        # Unroll through time
        for t in range(T):
            inp = x[:, t]  # [B, C, H, W]
            for layer_idx, cell in enumerate(self.cells):
                h_states[layer_idx], c_states[layer_idx] = cell(
                    inp, h_states[layer_idx], c_states[layer_idx]
                )
                inp = h_states[layer_idx]  # output feeds next layer

        # Use last hidden state from top layer
        h = self.dropout(h_states[-1])  # MC Dropout layer (p=0.1)
        pred = self.head(h)             # [B, 3, H, W]
        pred = torch.sigmoid(pred)
        return pred


# ---------------------------------------------------------------------------
# Quick sanity check
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    model = ConvLSTMForecaster()
    dummy = torch.randn(2, 5, 10, 64, 64)
    out = model(dummy)
    print(f"Input:  {dummy.shape}")
    print(f"Output: {out.shape}")
    total_params = sum(p.numel() for p in model.parameters())
    print(f"Parameters: {total_params:,}")
    assert out.shape == (2, 3, 64, 64), f"unexpected output {out.shape}"
    assert total_params == 270147, f"unexpected param count {total_params}"
    print("Sanity check: PASS")
