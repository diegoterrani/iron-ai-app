"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { NavLinks, type ItemNav } from "./nav-links";

interface Props {
  nome: string;
  produtos: ItemNav[];
  conta: ItemNav[];
  /** Botão de sair (formulário com server action, montado no servidor). */
  sair: ReactNode;
}

/**
 * Menu da área logada: produtos à esquerda (com a página atual marcada) e a
 * conta da pessoa num menu próprio. No celular, tudo fica atrás do botão
 * "Menu" e fecha sozinho ao trocar de página.
 */
export function MenuApp({ nome, produtos, conta, sair }: Props) {
  const pathname = usePathname();
  const [aberto, setAberto] = useState(false);
  const [contaAberta, setContaAberta] = useState(false);

  // Trocou de página: fecha os menus (ajuste durante a renderização, sem efeito).
  const [rota, setRota] = useState(pathname);
  if (rota !== pathname) {
    setRota(pathname);
    setAberto(false);
    setContaAberta(false);
  }

  // Esc fecha o menu da conta.
  useEffect(() => {
    if (!contaAberta) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContaAberta(false);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [contaAberta]);

  return (
    <>
      <button
        type="button"
        className="menu-botao"
        aria-expanded={aberto}
        aria-controls="menu-app"
        onClick={() => setAberto((a) => !a)}
      >
        {aberto ? "Fechar" : "Menu"}
      </button>
      <div id="menu-app" className={aberto ? "menu-app aberto" : "menu-app"}>
        <nav className="menu-produtos" aria-label="Principal">
          <NavLinks itens={produtos} />
        </nav>
        <div className="menu-conta">
          <button
            type="button"
            className="menu-conta-botao"
            aria-expanded={contaAberta}
            aria-controls="menu-conta-lista"
            onClick={() => setContaAberta((a) => !a)}
          >
            <span className="sr-only">Conta de </span>
            {nome}
          </button>
          <div id="menu-conta-lista" className={contaAberta ? "menu-conta-lista aberta" : "menu-conta-lista"}>
            <nav aria-label="Conta">
              <NavLinks itens={conta} />
            </nav>
            {sair}
          </div>
        </div>
      </div>
    </>
  );
}
