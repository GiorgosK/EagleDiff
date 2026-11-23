import { error } from "@sveltejs/kit";
import { posts } from "$lib/benchmark/content.js";

export const entries = () => posts.map(({ slug }) => ({ slug }));

export function load({ params }) {
	const post = posts.find(item => item.slug === params.slug);
	if (!post) error(404, "Not found");
	return { post };
}
