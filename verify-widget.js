$(function () {
    $('#searchForm').submit(searchCredentials);
});

/* ------METHODS------ */

function searchCredentials(e) {
    //We want to disable the search button until the grid loads, or else we get spammed with errors
    $('#submitButton').attr('disabled', 'disabled');

    e.preventDefault();
    // Check that form is not null.
    if ($('input#lastname').val().trim().length < 2 || $('input#firstname').val().trim().length < 1) {
        $("#submitButton").removeAttr('disabled');
        return;
    }

    var captchaResponse = grecaptcha.getResponse();
    if (captchaResponse == '') {
        CreateBootstrapAlert('#searchList', 'Captcha is required', 'alert-danger');
        $("#submitButton").removeAttr('disabled');
        return;
    }

    makeGrid(captchaResponse);
};

function showDetails(e, detailKey) {
$('#divDetailsModalContent').css('top', screen.height / 10);
$('#divDetailsModalContent').css('left', 0);

$.ajax({
    url: VerifyCredentialsGetDisplayDetailsUrl,
    type: 'POST',
    headers: { "RequestVerificationToken": $(':input[name="__RequestVerificationToken"]').val() }, // Add this so we can enforce token validation and prevent external requests.
    data: {
        key: detailKey, 
    },
        success: function (result) {
            $('#divDetailsModalContent').html(result);
        },
    });
}

/* ------GRID------ */

var defaultSort = { field: 'Name', dir: 'asc' };

function makeGrid(captchaResponse) {
var placeholder = $('#searchList');
placeholder.LoadingOverlay('show', { zIndex: 500 });
$.ajax({
    url: VerifyCredentialsSearchByNameUrl,
    type: 'POST',
    datatype: 'json',
    headers: { "RequestVerificationToken": $(':input[name="__RequestVerificationToken"]').val() }, // Add this so we can enforce token validation and prevent external requests.
    data: {
        firstName: $('input#firstname').val(),
        lastName: $('input#lastname').val(),
        captchaSuccessCode: captchaResponse,
    },
        success: function (result) {
            placeholder.html(result);
            placeholder.LoadingOverlay('hide');
            grecaptcha.reset();
            $("#submitButton").removeAttr('disabled');
        },
        error: function (jqxhr, status, error) {
            placeholder.LoadingOverlay('hide');
            if (jqxhr.status == 424) {
                CreateBootstrapAlert('#searchList', 'Captcha Failure. Please try again.', 'alert-danger');
            } else {
                CreateBootstrapAlert('#searchList', 'Failed to load Verify Credential Widget', 'alert-danger');
            }
            $("#submitButton").removeAttr('disabled');
        }
    })
}

