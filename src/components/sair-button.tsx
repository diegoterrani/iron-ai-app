import { sair } from "@/app/(auth)/actions";

export function SairButton() {
  return (
    <form action={sair}>
      <button type="submit" className="btn btn-secondary">
        Sair
      </button>
    </form>
  );
}
