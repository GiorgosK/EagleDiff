<script>
	import PageHeader from "$lib/benchmark/PageHeader.svelte";
	import Manifesto from "$lib/components/Manifesto.svelte";
	import Faq from "$lib/components/Faq.svelte";
	import Footer from "$lib/components/Footer.svelte";
</script>

<div class="bg-[#050505] text-white">
	<PageHeader eyebrow="Careers" title="Join the" accent="studio." intro="We hire rarely and keep people for a long time. Here is what working with us looks like." />
	<Manifesto />
	<Faq />
	<Footer />
</div>
