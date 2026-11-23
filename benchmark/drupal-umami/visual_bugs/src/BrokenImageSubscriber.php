<?php

namespace Drupal\visual_bugs;

use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Bugs that change a page's final response: broken images, late JavaScript,
 * a low-resolution image candidate and a server error.
 *
 * Only the response of the bug's page changes; render caches stay clean, so
 * the same images on other pages are unaffected.
 */
class BrokenImageSubscriber implements EventSubscriberInterface {

  const MISSING = '/sites/default/files/visual-bugs-missing.jpg';

  // b22: a notice bar inserted at the top of the page 2 seconds after load.
  const LATE_NOTICE = 'setTimeout(function () { var p = document.createElement("p"); p.className = "visual-bugs-notice"; p.textContent = "Envío gratis este fin de semana"; document.body.prepend(p); }, 2000);';

  // b25: a newsletter box fixed to the corner of the screen 1 second after load.
  const LATE_POPUP = 'setTimeout(function () { var d = document.createElement("div"); d.className = "visual-bugs-popup newsletter-popup"; d.innerHTML = "<strong>Boletín</strong><p>Recetas nuevas cada semana.</p>"; document.body.append(d); }, 1000);';

  public static function getSubscribedEvents(): array {
    return [KernelEvents::RESPONSE => ['onResponse', -10]];
  }

  public function onResponse(ResponseEvent $event): void {
    $bug = _visual_bugs_current();
    if (!$event->isMainRequest() || !in_array($bug, ['b05', 'b21', 'b22', 'b25', 'b26', 'b27'], TRUE)) {
      return;
    }
    $response = $event->getResponse();
    $html = $response->getContent();
    if (!is_string($html)) {
      return;
    }
    if ($bug === 'b05') {
      // b05: the first Victoria sponge image is the recipe's main image (HTTP 404).
      $html = preg_replace_callback('/<img\b[^>]*victoria-sponge-umami[^>]*>/', [$this, 'breakImage'], $html, 1);
    }
    elseif ($bug === 'b26') {
      // b26: the page fails with a server error.
      $response->setStatusCode(500);
      $html = '<!DOCTYPE html><html><head><title>Error</title></head><body>The website encountered an unexpected error. Try again later.</body></html>';
    }
    elseif ($bug === 'b27') {
      // b27: the main image's largest candidate (1536w, used by wide screens)
      // points to the 600px version, so wide screens show a blurry image.
      $html = preg_replace_callback('/<img\b[^>]*heritage-carrots[^>]*>/', function ($match) {
        return preg_replace_callback('/srcset="([^"]*)"/', function ($srcset) {
          preg_match('/(\S+) 600w/', $srcset[1], $small);
          return 'srcset="' . preg_replace('/\S+ 1536w/', $small[1] . ' 1536w', $srcset[1]) . '"';
        }, $match[0]);
      }, $html, 1);
    }
    elseif ($bug === 'b21') {
      // b21: the last lazy-loaded image of the page (HTTP 404).
      preg_match_all('/<img\b[^>]*loading="lazy"[^>]*>/', $html, $matches, PREG_OFFSET_CAPTURE);
      if ($last = end($matches[0])) {
        $html = substr_replace($html, $this->breakImage([$last[0]]), $last[1], strlen($last[0]));
      }
    }
    else {
      $script = $bug === 'b22' ? self::LATE_NOTICE : self::LATE_POPUP;
      $html = str_replace('</body>', "<script>$script</script></body>", $html);
    }
    $response->setContent($html);
  }

  private function breakImage(array $match): string {
    $image = preg_replace('/\s(srcset|sizes)="[^"]*"/', '', $match[0]);
    return preg_replace('/\ssrc="[^"]*"/', ' src="' . self::MISSING . '"', $image);
  }

}
