# Princípios de Engenharia Aresta (`aresta_backend`)

Para garantir que o nosso código, seja ele escrito por humanos ou por agentes autônomos de IA (como Google Antigravity e OPSX), se mantenha coeso, testável, sustentável e simples, adotamos oito princípios basilares e inegociáveis.

Estes princípios devem guiar toda e qualquer nova implementação, revisão ou refatoração no repositório de backend (Supabase Edge Functions, migrações SQL e Cloudflare Workers).

## I. Tudo em Português
Todo o repositório deve **OBRIGATORIAMENTE** ser em português brasileiro. Isso inclui, mas não se limita a: documentação, especificações (OpenSpec), comentários de código, docstrings (JSDoc/TSDoc), mensagens de erro, esquemas e tabelas de banco de dados, nomes de módulos, funções, métodos e variáveis.
*Exceções:* Nomes de bibliotecas de terceiros, APIs nativas do Deno/Cloudflare/Web Standards, termos técnicos consolidados do ecossistema e títulos de seção exigidos em inglês pelo schema do OpenSpec.

## II. Modularidade e Desacoplamento (Library-First)
Toda funcionalidade DEVE começar e ser estruturada como uma biblioteca ou módulo independente.
- As bibliotecas compartilhadas (como em `supabase/functions/compartilhado/` e módulos internos dos Workers) devem ser autossuficientes, testáveis de forma isolada e claramente documentadas.
- Evite criar arquivos que sirvam apenas para fins puramente organizacionais; cada módulo separado deve ter um propósito funcional claro e uma interface pública coesa.
- Não misture regras de negócios, parsers de protocolo ou validações diretamente dentro dos handlers HTTP brutos das Edge Functions.

## III. Testes Orientados a Comportamento e Espelhamento 1:1
Os testes devem validar **o que** o código faz (comportamento), e nunca **como** ele foi implementado internamente.
- **Espelhamento 1:1 Obrigatório**: QUALQUER arquivo `.ts` de lógica ou handler DEVE possuir um arquivo `_test.ts` (ou `.test.ts`) correspondente. Se decidimos separar código em um arquivo próprio, ele possui por definição uma interface pública que deve ser testada.
- **Um Teste por Comportamento (Behavior-Driven Testing)**: Cada bloco `Deno.test()` ou `it()` deve verificar um único comportamento ou regra de negócio observável através da API pública do módulo ou contrato HTTP (seguindo a estrutura *Dado/Quando/Então* ou *Preparar/Agir/Verificar*).
- **Proibição de Change-Detector Tests**: É estritamente proibido escrever testes acoplados à implementação interna (inspecionar variáveis privadas, verificar chamadas de funções auxiliares internas ou replicar a lógica de produção dentro do asserto). Uma refatoração interna que preserve o contrato público nunca deve quebrar os testes.

## IV. 100% de Cobertura Comportamental e TDD (Red-Green-Refactor)
O Desenvolvimento Orientado a Testes (Test-Driven Development) e a cobertura integral são **obrigatórios** e inegociáveis.
- **Ciclo Red-Green-Refactor**: Os testes DEVEM ser escritos e vistos falhar (*Red*) antes do início de qualquer implementação de código de produção (*Green*), seguidos de refatoração (*Refactor*).
- **100% de Test Coverage via Comportamento**: Qualquer alteração submetida deve manter 100% de cobertura de testes atingida exclusivamente exercitando comportamentos reais pela interface pública.
- **Resolução de Cobertura pelo Design**: Se uma linha ou ramificação (`if/else`, `try/catch`) não puder ser alcançada por um teste de comportamento público, **o defeito está no código de produção** (código morto, validação defensiva redundante ou acoplamento direto de I/O). A solução obrigatória é simplificar o código de produção ou remover a ramificação inalcançável — sendo proibido usar mocks internos ou chamar funções privadas para forçar cobertura artificial.

## V. Fidelidade de Produção, Anti-Mocking e Testes de Integração em Primeiro Lugar
A suíte de testes deve ser representativa do comportamento real do sistema em produção.
- **Testes de Integração em Primeiro Lugar**: Priorize testar as fronteiras e os contratos HTTP/WebSocket/SQL entre os componentes do sistema antes de descer para detalhes isolados.
- **Proibição de Mocks para Código Interno**: É proibido usar mocks ou spies (`vi.mock`, `stub`, `spy`) para isolar validadores, parsers, gerenciadores de sessão ou bibliotecas internas do próprio projeto. Use sempre as implementações reais e bancos locais/em memória (como SQLite/D1 local).
- **Bibliotecas `test-only` de Fakes Determinísticos**: Para fronteiras externas (GitHub API, Supabase Auth/Storage/REST, Discord Webhooks ou R2), devem ser utilizadas **bibliotecas `test-only` de Fakes determinísticos** em memória (configuráveis inclusive para simular falhas determinísticas de rede/status HTTP), evitando reimplementar stubs ad-hoc em cada arquivo de teste.
- **Fakes Também São Bibliotecas Testadas**: Toda biblioteca de Fake (`*_fake.ts`) é uma biblioteca de primeira classe e DEVE obrigatoriamente possuir seu próprio arquivo de teste espelhado (`*_fake_test.ts`) garantindo que o Fake cumpre fielmente o contrato real.

## VI. Simplicidade, Anti-Abstração e Documentação Contínua
O código DEVE ser simples, declarativo, bem documentado e fácil de compreender.
- Evite abstrações prematuras e códigos "espertos" (complexidade desnecessária). Siga a regra de ouro: *"Melhor um pouco de duplicação do que a abstração errada."*
- Pratique o DRY (Don't Repeat Yourself) de forma prudente: extraia apenas o que for óbvio e simples para reutilização clara.
- Mantenha comentários explicando *o porquê* (intenção e invariantes de segurança) e atualize os arquivos `README.md` pertinentes sempre que introduzir ou alterar funções, rotas ou variáveis de ambiente.

## VII. Inegociabilidade Perante Código Legado (Regra do Escoteiro)
A existência de código ou testes legados no repositório que ainda não sigam integralmente estes padrões **NÃO é desculpa nem precedente** para violá-los.
- Agentes autônomos e desenvolvedores estão proibidos de imitar antipadrões presentes em arquivos vizinhos (como mocks ad-hoc, *change-detector tests* ou identificadores em inglês).
- Sempre que tocar em um arquivo ou módulo existente que viole este `AGENTS.md`, você DEVE refatorar o trecho e os testes afetados para que passem a seguir integralmente estes princípios.

## VIII. Eficiência de Borda (Edge-First) e Isolamento Compartilhado
Toda funcionalidade de backend deve ser desenhada para execução enxuta na borda (Supabase Edge Functions e Cloudflare Workers) com **menor custo de operação e latência**:
- Os handlers de Edge Functions e Workers devem atuar como uma camada fina de roteamento, autenticação JWT, validação de segurança e orquestração de acesso a dados (D1, R2, Supabase, GitHub).
- Toda lógica de protocolo (como análise de `pkt-line` do Git Smart HTTP, regras de nomenclatura de branches `sugestao-*` e validação de escopo de arquivos) deve permanecer desacoplada em bibliotecas puras dentro de `compartilhado/` ou módulos de domínio dedicados.

---
> **Nota para Agentes Autônomos**: Vocês estão estritamente obrigados a considerar este documento como diretriz de mais alta prioridade ao planejar arquitetura, sugerir refatorações, ou implementar novas rotinas (incluindo o uso do OpenSpec).
