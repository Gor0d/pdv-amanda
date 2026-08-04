# -*- coding: utf-8 -*-
"""
Gera o icone do app e as imagens do instalador a partir da paleta do sistema.

Rodar: python recursos/gerar-assets.py

Os arquivos gerados sao versionados junto (o build nao depende de Python),
mas o script fica no repositorio para que a identidade possa ser refeita sem
abrir editor de imagem.

Motivo do desenho: no menu Iniciar e na barra de tarefas o icone aparece a
16-32 px. Detalhe some nesse tamanho, entao a silhueta do cupom com a borda
picotada e o ponto verde carregam o reconhecimento sozinhos -- sao os mesmos
dois elementos que a dona da loja ja ve na tela do sistema.
"""

from PIL import Image, ImageDraw, ImageFont
import os

RAIZ = os.path.dirname(os.path.abspath(__file__))

# Paleta identica a de src/renderer/css/base.css
INK        = (31, 42, 34)
INK_SOFT   = (91, 100, 89)
BG         = (244, 242, 234)
PAPER      = (255, 255, 255)
PAPER_EDGE = (230, 225, 211)
GREEN      = (46, 125, 91)
GREEN_DARK = (30, 92, 65)
LINE       = (218, 213, 198)


def retangulo_arredondado(d, caixa, raio, cor):
    d.rounded_rectangle(caixa, radius=raio, fill=cor)


def desenhar_cupom(d, x, y, largura, altura, escala, com_dobra=True):
    """Cupom de papel com a borda inferior picotada."""
    d.rectangle([x, y, x + largura, y + altura], fill=PAPER)

    # Borda picotada de baixo: triangulos alternados, como papel destacado.
    if com_dobra:
        dente = max(3, int(largura / 9))
        px = x
        while px < x + largura:
            d.polygon(
                [(px, y + altura), (px + dente / 2, y + altura + dente * 0.55), (px + dente, y + altura)],
                fill=PAPER,
            )
            px += dente

    # Linhas de texto. Poucas e grossas de proposito: a 16 px, tres linhas
    # finas viram um borrao cinza e o icone perde a leitura de "cupom".
    pad = largura * 0.17
    espessura = max(2, escala * 7)
    for frac in (0.28, 0.48):
        ly = y + altura * frac
        d.rectangle([x + pad, ly, x + largura - pad, ly + espessura], fill=INK_SOFT)

    # Linha do total: mais grossa, verde e mais curta -- e o numero que importa.
    ly = y + altura * 0.70
    d.rectangle(
        [x + pad, ly, x + largura - pad * 1.9, ly + espessura * 1.5],
        fill=GREEN_DARK,
    )


def gerar_icone():
    """ICO multi-resolucao para o .exe, o atalho e a barra de tarefas."""
    N = 1024
    img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    margem = N * 0.06
    retangulo_arredondado(d, [margem, margem, N - margem, N - margem], int(N * 0.22), INK)

    lc = N * 0.52
    lh = N * 0.52
    desenhar_cupom(d, (N - lc) / 2, N * 0.17, lc, lh, N / 256)

    # Ponto verde: o mesmo marcador do cabecalho do sistema. Vai como emblema
    # no canto, com um anel na cor do fundo, senao encosta na quina do cupom e
    # os dois viram uma mancha so.
    r = N * 0.105
    cx, cy = N * 0.735, N * 0.735
    d.ellipse([cx - r * 1.32, cy - r * 1.32, cx + r * 1.32, cy + r * 1.32], fill=INK)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=GREEN)

    destino = os.path.join(RAIZ, "icone.ico")
    img.save(
        destino,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("gerado:", destino)

    # PNG grande para o README e para a tela "Sobre".
    img.resize((512, 512), Image.LANCZOS).save(os.path.join(RAIZ, "icone.png"))
    print("gerado:", os.path.join(RAIZ, "icone.png"))


def fonte(tamanho, negrito=False):
    for nome in (["segoeuib.ttf", "arialbd.ttf"] if negrito else ["segoeui.ttf", "arial.ttf"]):
        try:
            return ImageFont.truetype(nome, tamanho)
        except OSError:
            continue
    return ImageFont.load_default()


def gerar_lateral_instalador(destino, titulo, subtitulo):
    """BMP 164x314 da lateral do instalador NSIS (telas de boas-vindas e fim)."""
    L, A = 164, 314
    img = Image.new("RGB", (L, A), INK)
    d = ImageDraw.Draw(img)

    # Faixa de cor no rodape, para a arte nao terminar seca.
    d.rectangle([0, A - 46, L, A], fill=GREEN_DARK)

    desenhar_cupom(d, 44, 54, 76, 84, 1.0)

    r = 9
    d.ellipse([104 - r, 132 - r, 104 + r, 132 + r], fill=GREEN)

    f_tit = fonte(15, negrito=True)
    f_sub = fonte(11)

    d.text((L / 2, 186), titulo, font=f_tit, fill=BG, anchor="mm")
    for i, linha in enumerate(subtitulo):
        d.text((L / 2, 210 + i * 15), linha, font=f_sub, fill=(150, 160, 148), anchor="mm")

    img.save(destino, format="BMP")
    print("gerado:", destino)


def gerar_cabecalho_instalador(destino):
    """BMP 150x57 do topo das telas internas do instalador."""
    L, A = 150, 57
    img = Image.new("RGB", (L, A), (255, 255, 255))
    d = ImageDraw.Draw(img)

    desenhar_cupom(d, 12, 8, 30, 34, 0.5, com_dobra=False)
    d.rectangle([12, 8, 42, 42], outline=PAPER_EDGE)

    r = 4
    d.ellipse([46 - r, 38 - r, 46 + r, 38 + r], fill=GREEN)

    d.text((58, 18), "Sistema", font=fonte(13, negrito=True), fill=INK)
    d.text((58, 33), "de Vendas", font=fonte(11), fill=INK_SOFT)

    img.save(destino, format="BMP")
    print("gerado:", destino)


if __name__ == "__main__":
    gerar_icone()
    gerar_lateral_instalador(
        os.path.join(RAIZ, "installerSidebar.bmp"),
        "Sistema de Vendas",
        ["Vendas, estoque", "e controle de caixa"],
    )
    # O medo de quem desinstala e perder o movimento da loja. A lateral da
    # desinstalacao responde isso antes de a pessoa clicar.
    gerar_lateral_instalador(
        os.path.join(RAIZ, "uninstallerSidebar.bmp"),
        "Sistema de Vendas",
        ["Seus dados e backups", "não serão apagados"],
    )
    gerar_cabecalho_instalador(os.path.join(RAIZ, "installerHeader.bmp"))
