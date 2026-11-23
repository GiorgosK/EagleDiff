import { error } from "@sveltejs/kit";
import { works } from "$lib/benchmark/content.js";

export const entries = () => works.map(({ slug }) => ({ slug }));

export function load({ params }) {
	const index = works.findIndex(work => work.slug === params.slug);
	if (index === -1) error(404, "Not found");
	return { work: works[index], next: works[(index + 1) % works.length] };
}
