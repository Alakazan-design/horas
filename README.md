# Horas

Conta as horas trabalhadas em cada projeto. Cada projeto tem itens, cada item tem seu cronômetro,
e o tempo do projeto é a soma dos itens. Só um item conta por vez.

Com o celular na horizontal, o app vira uma tela de foco: só o cronômetro e o botão de play/pausa,
com a tela sempre acesa. Para sair, volte o celular para a vertical.

O **Relatório** (cartão "Hoje" na tela inicial) mostra o tempo por dia, semana e mês, com médias,
comparação com o período anterior e divisão por projeto e por item. Ele usa as sessões registradas
(cada play → pausa); o tempo registrado antes do relatório existir fica só nos totais.

## Instalar no iPhone

1. Abra o endereço do app no **Safari**.
2. Toque em **Compartilhar → Adicionar à Tela de Início**.
3. Abra sempre pelo ícone. Os dados ficam guardados no aparelho, separados do Safari.
4. Para o modo foco, desligue o **Bloqueio de Rotação** na Central de Controle.

## Arquivos

- `index.html`, `styles.css`, `app.js`: o app (HTML, CSS e JavaScript puros, sem build).
- `sw.js`: permite abrir o app sem internet.
- `manifest.webmanifest` e `icons/`: nome e ícone na tela de início.

Os dados ficam no `localStorage` do aparelho. Use **⋯ → Exportar backup** de vez em quando.
