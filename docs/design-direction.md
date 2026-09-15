# Dashboard operacional

Extensão da identidade existente: fundo #0a0a0a, superfícies #171717, acento azul
#1e9dc8, Montserrat local e números em monospace. Densidade compacta, bordas finas,
raios de 12px. Cor adicional apenas para estado. Sem biblioteca visual nova.

1. Resumo: saúde do agendador e dimensão da operação, separados do período histórico.
2. Faixa de indicadores: resultados, taxa de erro com denominador e tempo de execução.
3. Assinatura visual: horizonte de 24 horas em três pistas de executor, intensidade por
   quantidade de ocorrências; selecionar uma hora revela a agenda daquele intervalo.
4. Próxima execução em destaque e lista cronológica, com horários locais do servidor.
5. Fila e execuções vivas com tempo decorrido e acesso ao log.
6. Atividade do período e falhas agrupadas por rotina, com volume e última falha.

Gráficos são os elementos visuais, sem fotos decorativas. Sem animação nova contínua.
Estados vazios, indisponibilidade e dados antigos são explícitos. PT e EN, teclado,
contraste e layouts de 360, 768 e 1280px. A tela consulta dados e abre logs; não dispara jobs.
